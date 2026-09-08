import fs from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import lock from '../../../../runtime/codex.lock.json';
import { CodexTransport } from './transport';
import { initializeCodex } from './initialize';
import { verifyExecutionConfiguration } from './configuration';

interface ProcessOptions {
  resourcesDirectory: string;
  engineHome: string;
  workingDirectory: string;
  environment: NodeJS.ProcessEnv;
  overrides?: string[];
}

// 产品执行入口只返回已经核对生效配置的连接；低层 openCodex 保留给资源/协议探针。
export async function openExecutionCodex(options: ProcessOptions, handlers: ConstructorParameters<typeof CodexTransport>[2]) {
  const runtime = await openCodex(options, handlers);
  try {
    await verifyExecutionConfiguration(runtime.transport, options.workingDirectory);
    return runtime;
  } catch (error) {
    try { await runtime.close(); }
    catch (closeError) { throw new AggregateError([error, closeError], '引擎配置核对失败，且进程回收未确认；禁止发送任务'); }
    throw error;
  }
}

export async function openCodex(options: ProcessOptions, handlers: ConstructorParameters<typeof CodexTransport>[2]) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('固定引擎仅支持 Windows x64');
  if (![options.resourcesDirectory, options.engineHome, options.workingDirectory].every(value => path.isAbsolute(value))) throw new Error('引擎资源与工作目录必须为绝对路径');
  const home = await realpath(options.engineHome), cwd = await realpath(options.workingDirectory);
  const binary = path.join(options.resourcesDirectory, 'engine', lock.version, 'win32-x64', lock.binary.name);
  const stat = await lstat(binary);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== lock.binary.bytes) throw new Error('安装包内固定引擎资源无效，拒绝启动');
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(binary)) hash.update(chunk);
  if (hash.digest('hex') !== lock.binary.sha256) throw new Error('安装包内固定引擎摘要不符，拒绝启动');

  // 只使用产品配置模块明确提供的环境，不隐式合并当前进程的 Key 或其他 Codex 目录覆盖。
  const environment = Object.fromEntries(Object.entries(options.environment).filter(([key]) => !/^CODEX_/i.test(key)));
  environment.CODEX_HOME = home;
  const child = spawn(binary, [...(options.overrides ?? []).flatMap(value => ['-c', value]),
    '-c', 'features.multi_agent=false', '-c', 'features.multi_agent_v2=false', '-c', 'features.guardian_approval=false',
    '-c', 'model="deepseek-v4-flash"', '-c', 'model_provider="deepseek"', '-c', 'approval_policy="on-request"', '-c', 'sandbox_mode="workspace-write"',
    'app-server', '--strict-config', '--listen', 'stdio://'], { cwd, env: environment, shell: false, windowsHide: true, stdio: 'pipe' });
  let exited = false;
  let spawnCode: string | null = null;
  let stderrBytes = 0;
  const closed = new Promise<void>(resolve => child.once('close', () => { exited = true; resolve(); }));
  const transport = new CodexTransport(child.stdin, child.stdout, handlers);
  child.on('error', (error: NodeJS.ErrnoException) => { spawnCode = error.code ?? 'UNKNOWN'; transport.close(); });
  // 原始 stderr 可能含配置或请求内容，不向日志/Renderer 复制；保留发生量和进程退出事实。
  child.stderr.on('data', (chunk: Buffer) => { stderrBytes += chunk.length; });
  let closing: Promise<void> | null = null;
  function close(): Promise<void> {
    if (closing) return closing;
    closing = (async () => {
      transport.close();
      if (exited) return;
      child.stdin.end();
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([closed, new Promise<void>((_, reject) => {
          timer = setTimeout(() => {
            if (!exited && !child.kill()) reject(new Error('无法回收本实例引擎进程，状态需人工核对'));
            else {
              timer = setTimeout(() => reject(new Error('引擎进程未确认退出，状态需人工核对')), 5000);
            }
          }, 5000);
        })]);
      } finally { if (timer) clearTimeout(timer); }
    })();
    return closing;
  }
  try {
    const hello = await initializeCodex(transport, home);
    if (!child.pid || exited) throw new Error('引擎在握手完成前已退出');
    return { hello, transport, pid: child.pid, close };
  } catch (cause) {
    await close();
    const reason = cause instanceof Error ? cause.message : '未知启动错误';
    throw new Error(`${reason}（启动错误码 ${spawnCode ?? '无'}，退出码 ${child.exitCode ?? '未知'}，stderr ${stderrBytes} 字节）`);
  }
}
