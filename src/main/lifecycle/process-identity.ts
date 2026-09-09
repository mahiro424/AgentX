import path from 'node:path';
import { execFile } from 'node:child_process';

export interface ProcessIdentity { pid: number; parentPid: number; createdAt: string; executablePath: string }

export function validateProcessIdentity(value: unknown): ProcessIdentity {
  const identity = value as Partial<ProcessIdentity> | null;
  if (!identity || typeof identity !== 'object' || Array.isArray(identity) || Object.keys(identity).length !== 4 ||
      !Number.isSafeInteger(identity.pid) || Number(identity.pid) <= 0 || Number(identity.pid) > 0xffffffff ||
      !Number.isSafeInteger(identity.parentPid) || Number(identity.parentPid) < 0 || Number(identity.parentPid) > 0xffffffff ||
      typeof identity.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,7}Z$/u.test(identity.createdAt) || !Number.isFinite(Date.parse(identity.createdAt)) ||
      typeof identity.executablePath !== 'string' || !path.isAbsolute(identity.executablePath) || identity.executablePath.length > 32767 || identity.executablePath.includes('\0')) {
    throw new Error('进程身份信息不完整，不能据此确认归属');
  }
  return identity as ProcessIdentity;
}

export function sameProcessIdentity(expected: ProcessIdentity, current: ProcessIdentity | null): boolean {
  validateProcessIdentity(expected);
  if (!current) return false;
  validateProcessIdentity(current);
  return expected.pid === current.pid && expected.parentPid === current.parentPid && expected.createdAt === current.createdAt &&
    path.normalize(expected.executablePath).toLowerCase() === path.normalize(current.executablePath).toLowerCase();
}

// PID 可被复用；只查询身份，不提供结束任意 PID 的能力，也不把根进程消失等同后台全部结束。
export async function readProcessIdentity(pid: number): Promise<ProcessIdentity | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 0xffffffff) throw new Error('进程标识无效');
  if (process.platform !== 'win32') throw new Error('当前进程身份核验仅支持 Windows');
  const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  // 四个标量直接成帧；路径用 UTF-8/Base64，避免额外 JSON 模块加载和分隔符歧义。
  const script = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); ` +
    `$p=Get-CimInstance -ClassName Win32_Process -Filter 'ProcessId=${pid}' -ErrorAction Stop; ` +
    `if(!$p){[Console]::Out.WriteLine('null')}else{` +
    `$fields=[string[]]@('AXPI1',[int64]$p.ProcessId,[int64]$p.ParentProcessId,$p.CreationDate.ToUniversalTime().ToString('o'),` +
    `[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$p.ExecutablePath))); ` +
    `[Console]::Out.WriteLine([string]::Join([string][char]9,$fields))}`;
  const output = await new Promise<string>((resolve, reject) => {
    execFile(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, shell: false, encoding: 'utf8', timeout: 10000, maxBuffer: 65536 }, (error, stdout) => {
        if (error) reject(new Error(`无法读取进程身份，需核对（查询错误码 ${error.code ?? (error.killed ? '10 秒超时终止' : '未知')}${error.signal ? `；信号 ${error.signal}` : ''}）`));
        else resolve(stdout);
      });
  });
  if (output.trim() === 'null') return null;
  let value: ProcessIdentity;
  try {
    const fields = output.trim().split('\t');
    if (fields.length !== 5 || fields[0] !== 'AXPI1' || !/^[1-9]\d*$/u.test(fields[1]) || !/^(0|[1-9]\d*)$/u.test(fields[2])) throw new Error('invalid-frame');
    const bytes = Buffer.from(fields[4], 'base64');
    if (bytes.toString('base64') !== fields[4]) throw new Error('invalid-base64');
    value = { pid: Number(fields[1]), parentPid: Number(fields[2]), createdAt: fields[3], executablePath: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) };
  }
  catch { throw new Error('进程身份查询返回无效数据，不能当作进程不存在'); }
  const identity = validateProcessIdentity(value);
  if (identity.pid !== pid) throw new Error('进程身份查询关联不匹配');
  return identity;
}
