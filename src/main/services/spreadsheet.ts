import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Spreadsheet } from '../../shared/contracts/spreadsheet';

const readers = new Set<ChildProcess>();
process.once('exit', () => { for (const reader of readers) reader.kill(); });

// 输入只来自 Main 核验后的文件字节；解析子进程不接收路径、凭据或任意命令。
export async function readSpreadsheet(bytes: Buffer, extension: string): Promise<Spreadsheet> {
  if (!Buffer.isBuffer(bytes) || bytes.length > 8 * 1024 * 1024 || !['.csv', '.xlsx'].includes(extension)) throw new Error('表格格式或大小不符合读取范围');
  if (readers.size >= 2) throw new Error('表格解析忙碌，请等待当前读取结束后重试');
  const modulePath = __filename.endsWith('.ts') ? path.join(__dirname, '../tools/office-reader.cjs') : path.join(__dirname, 'office-reader.js');
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|WINDIR|TEMP|TMP)$/i.test(key)));
  const child = spawn(process.execPath, ['--max-old-space-size=192', modulePath], {
    env: { ...environment, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
  });
  readers.add(child);
  return new Promise((resolve, reject) => {
    let output = '', errorText = '', outputSize = 0, failure: Error | undefined;
    const stop = (reason: Error) => { failure ??= reason; child.kill(); };
    const timer = setTimeout(() => stop(new Error('表格解析超过 10 秒，已请求结束本次解析')), 10000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { outputSize += Buffer.byteLength(chunk); if (outputSize > 8 * 1024 * 1024) stop(new Error('表格读取结果超限')); else output += chunk; });
    child.stderr.on('data', (chunk: string) => { errorText = (errorText + chunk).slice(0, 4096); });
    child.stdin.on('error', () => { failure ??= new Error('表格解析输入管道已关闭'); });
    child.on('error', error => { failure ??= error; });
    child.on('close', code => {
      readers.delete(child);
      clearTimeout(timer);
      if (failure || code !== 0) { reject(failure ?? new Error(`表格解析失败：${errorText || `退出码 ${code}`}`)); return; }
      try {
        const value = JSON.parse(output) as Spreadsheet;
        if (value.parserPid !== child.pid || value.format !== extension.slice(1) || !Array.isArray(value.sheets)) throw new Error('表格解析响应关联无效');
        resolve(value);
      } catch (cause) { reject(cause); }
    });
    child.stdin.end(JSON.stringify({ bytes: bytes.toString('base64'), extension }));
  });
}
