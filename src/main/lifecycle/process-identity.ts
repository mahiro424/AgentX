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
  const script = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); ` +
    `$p=Get-CimInstance -ClassName Win32_Process -Filter 'ProcessId=${pid}' -ErrorAction Stop; ` +
    `if(!$p){'null'}else{@{pid=[int64]$p.ProcessId;parentPid=[int64]$p.ParentProcessId;createdAt=$p.CreationDate.ToUniversalTime().ToString('o');executablePath=$p.ExecutablePath}|ConvertTo-Json -Compress}`;
  const output = await new Promise<string>((resolve, reject) => {
    execFile(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, shell: false, encoding: 'utf8', timeout: 10000, maxBuffer: 65536 }, (error, stdout) => {
        if (error) reject(new Error(`无法读取进程身份，需核对（查询错误码 ${error.code ?? (error.killed ? '10 秒超时终止' : '未知')}${error.signal ? `；信号 ${error.signal}` : ''}）`));
        else resolve(stdout);
      });
  });
  let value: unknown;
  try { value = JSON.parse(output.trim()); }
  catch { throw new Error('进程身份查询返回无效数据，不能当作进程不存在'); }
  if (value === null) return null;
  const identity = validateProcessIdentity(value);
  if (identity.pid !== pid) throw new Error('进程身份查询关联不匹配');
  return identity;
}
