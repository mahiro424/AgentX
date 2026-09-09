import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const WORKSPACE_SCAN_LIMITS = { fileBytes: 1024 * 1024, totalBytes: 32 * 1024 * 1024, entries: 10000, depth: 64 } as const;
export const workspaceFileLimit = (filename: string) => ['.csv', '.xlsx'].includes(path.extname(filename).toLowerCase()) ? 8 * 1024 * 1024 : WORKSPACE_SCAN_LIMITS.fileBytes;
const excludedNames = ['.git', 'node_modules'];
export interface WorkspaceFile { path: string; sha256: string; size: number; text: string | null }
export interface WorkspaceIssue { path: string; reason: 'unreadable' | 'link' | 'limit' | 'changedDuringRead'; code?: string }
export interface WorkspaceSnapshot {
  directory: string;
  capturedAt: string;
  files: WorkspaceFile[];
  issues: WorkspaceIssue[];
  excludedNames: string[];
}

export type WorkspaceGitState = { status: 'available'; changes: { path: string; index: string; worktree: string }[] }
  | { status: 'notRepository' | 'unavailable'; message: string };

export async function captureGitState(directory: string): Promise<WorkspaceGitState> {
  if (!path.isAbsolute(directory)) throw new Error('工作区必须为绝对目录');
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(SystemRoot|WINDIR|TEMP|TMP|PATH|PATHEXT|COMSPEC|USERPROFILE|APPDATA|LOCALAPPDATA|HOME)$/i.test(key)));
  Object.assign(environment, { GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' });
  const git = (args: string[]) => promisify(execFile)('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false',
    '-c', 'core.untrackedCache=false', ...args], { cwd: directory, env: environment, windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024, encoding: 'buffer' });
  try {
    const root = new TextDecoder('utf-8', { fatal: true }).decode((await git(['rev-parse', '--show-toplevel'])).stdout).trimEnd();
    if (!path.isAbsolute(root)) throw new Error('invalid-git-root');
    const output = new TextDecoder('utf-8', { fatal: true }).decode((await git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames', '--', '.'])).stdout);
    const records = output ? output.split('\0') : [];
    if (records.length && records.pop() !== '') throw new Error('incomplete-git-output');
    const changes = records.map(record => {
      if (!/^[ MADRCUT?!]{2} /.test(record) || record.length < 4) throw new Error('invalid-git-status');
      const relative = path.relative(directory, path.resolve(root, record.slice(3)));
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('git-path-outside-workspace');
      return { path: relative.split(path.sep).join('/'), index: record[0], worktree: record[1] };
    });
    return { status: 'available', changes };
  } catch (error) {
    const value = error as { code?: unknown; stderr?: Buffer };
    if (value.code === 128 && value.stderr?.toString('utf8').includes('not a git repository')) return { status: 'notRepository', message: '普通目录；以文件基线比较，不提供 Git 既有改动信息' };
    return { status: 'unavailable', message: 'Git 状态未能读取；既有 Git 改动尚未核对' };
  }
}

// 这是有明确覆盖范围的逐文件观察，不是原子快照，也不证明改动来自哪个进程。
export async function captureWorkspace(directory: string): Promise<WorkspaceSnapshot> {
  if (!path.isAbsolute(directory)) throw new Error('工作区必须为绝对目录');
  const root = await fs.realpath(directory);
  if (!(await fs.lstat(root)).isDirectory()) throw new Error('工作区目录不可读取，未建立基线');
  const files: WorkspaceFile[] = [], issues: WorkspaceIssue[] = [];
  const failedRead = (name: string, error: unknown) => {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    issues.push({ path: name, reason: 'unreadable', ...(typeof code === 'string' && /^E[A-Z0-9_]{1,30}$/.test(code) ? { code } : {}) });
  };
  let entries = 0, totalBytes = 0;
  const relative = (file: string) => path.relative(root, file).split(path.sep).join('/');
  const unchanged = (left: Awaited<ReturnType<typeof fs.stat>>, right: Awaited<ReturnType<typeof fs.stat>>) =>
    left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
  const visit = async (folder: string, depth: number): Promise<void> => {
    if (depth > WORKSPACE_SCAN_LIMITS.depth || entries >= WORKSPACE_SCAN_LIMITS.entries) {
      issues.push({ path: relative(folder), reason: 'limit' }); return;
    }
    try {
      if (await fs.realpath(folder) !== folder || (await fs.lstat(folder)).isSymbolicLink()) {
        issues.push({ path: relative(folder), reason: 'link' }); return;
      }
      for await (const entry of await fs.opendir(folder)) {
        const filename = path.join(folder, entry.name), name = relative(filename);
        if (++entries > WORKSPACE_SCAN_LIMITS.entries) { issues.push({ path: relative(folder), reason: 'limit' }); break; }
        if (excludedNames.includes(entry.name.toLowerCase())) continue;
        try {
          const initial = await fs.lstat(filename);
          if (initial.isSymbolicLink() || await fs.realpath(filename) !== filename) { issues.push({ path: name, reason: 'link' }); continue; }
          if (initial.isDirectory()) { await visit(filename, depth + 1); continue; }
          if (!initial.isFile()) { issues.push({ path: name, reason: 'unreadable' }); continue; }
          if (initial.size > workspaceFileLimit(filename) || totalBytes + initial.size > WORKSPACE_SCAN_LIMITS.totalBytes) {
            issues.push({ path: name, reason: 'limit' }); continue;
          }
          const handle = await fs.open(filename, 'r');
          try {
            const before = await handle.stat();
            if (!before.isFile() || !unchanged(initial, before)) { issues.push({ path: name, reason: 'changedDuringRead' }); continue; }
            totalBytes += initial.size;
            // 多读一个字节用于识别读取期间增长；不使用可能无界分配的 readFile。
            const buffer = Buffer.alloc(initial.size + 1);
            let length = 0;
            while (length < buffer.length) {
              const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
              if (bytesRead === 0) break;
              length += bytesRead;
            }
            if (length !== initial.size || !unchanged(before, await handle.stat()) || await fs.realpath(filename) !== filename ||
                !unchanged(initial, await fs.lstat(filename))) { issues.push({ path: name, reason: 'changedDuringRead' }); continue; }
            const content = buffer.subarray(0, length);
            let text: string | null = null;
            if (length <= WORKSPACE_SCAN_LIMITS.fileBytes && !content.includes(0)) {
              try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content); }
              catch { /* 非 UTF-8 保留指纹，不伪造可展示文本。 */ }
            }
            files.push({ path: name, sha256: createHash('sha256').update(content).digest('hex'), size: length, text });
          } finally { await handle.close(); }
        } catch (error) { failedRead(name, error); }
      }
    } catch (error) { failedRead(relative(folder), error); }
  };
  await visit(root, 0);
  return { directory: root, capturedAt: new Date().toISOString(), files: files.sort((a, b) => a.path.localeCompare(b.path)), issues,
    excludedNames: [...excludedNames] };
}

export function compareWorkspaceSnapshots(before: WorkspaceSnapshot, after: WorkspaceSnapshot) {
  if (before.directory !== after.directory || JSON.stringify(before.excludedNames) !== JSON.stringify(after.excludedNames)) throw new Error('工作区或比较范围不一致');
  const issues = [...before.issues, ...after.issues];
  const oldFiles = new Map(before.files.map(file => [file.path, file]));
  const newFiles = new Map(after.files.map(file => [file.path, file]));
  const changes: { path: string; operation: 'add' | 'update' | 'delete'; before: WorkspaceFile | null; after: WorkspaceFile | null }[] = [];
  for (const name of [...new Set([...oldFiles.keys(), ...newFiles.keys()])].sort()) {
    if (issues.some(issue => issue.path === '' || name === issue.path || name.startsWith(`${issue.path}/`))) continue;
    const oldFile = oldFiles.get(name), newFile = newFiles.get(name);
    if (oldFile?.sha256 === newFile?.sha256) continue;
    changes.push({ path: name, operation: !oldFile ? 'add' : !newFile ? 'delete' : 'update', before: oldFile ?? null, after: newFile ?? null });
  }
  return { complete: issues.length === 0, changes, issues };
}
