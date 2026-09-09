import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { WORKSPACE_SCAN_LIMITS, workspaceFileLimit, type WorkspaceSnapshot, type WorkspaceGitState } from '../services/workspace-results';

interface ResultBinding { taskId: string; operationId: string }
interface WorkspaceBaseline extends ResultBinding { version: 1; snapshot: WorkspaceSnapshot; git: WorkspaceGitState }
const maximumBytes = 64 * 1024 * 1024;
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
const relativePath = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 32767 &&
  !/[\\:\u0000-\u001f]/u.test(value) && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');

function validate(value: WorkspaceBaseline, binding: ResultBinding): void {
  if (!value || value.version !== 1 || value.taskId !== binding.taskId || value.operationId !== binding.operationId) throw new Error('基线任务或操作归属不匹配');
  const snapshot = value.snapshot;
  if (!snapshot || typeof snapshot.directory !== 'string' || !path.isAbsolute(snapshot.directory) ||
      typeof snapshot.capturedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.capturedAt)) ||
      !Array.isArray(snapshot.files) || snapshot.files.length > WORKSPACE_SCAN_LIMITS.entries ||
      !Array.isArray(snapshot.issues) || !Array.isArray(snapshot.excludedNames) ||
      !snapshot.excludedNames.every(name => typeof name === 'string' && relativePath(name) && !name.includes('/'))) throw new Error('基线内容结构无效');
  const names = new Set<string>();
  for (const file of snapshot.files) {
    if (!file || !relativePath(file.path) || names.has(file.path) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > workspaceFileLimit(file.path) ||
        typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256) || (file.text !== null && typeof file.text !== 'string')) throw new Error('基线文件记录无效');
    if (file.text !== null && (Buffer.byteLength(file.text) !== file.size || digest(file.text) !== file.sha256)) throw new Error('基线文件内容校验失败');
    names.add(file.path);
  }
  if (!snapshot.issues.every(issue => issue && (issue.path === '' || relativePath(issue.path)) &&
      ['unreadable', 'link', 'limit', 'changedDuringRead'].includes(issue.reason) &&
      (issue.code === undefined || (typeof issue.code === 'string' && /^E[A-Z0-9_]{1,30}$/.test(issue.code))))) throw new Error('基线覆盖范围无效');
  const git = value.git;
  if (!git || !['available', 'notRepository', 'unavailable'].includes(git.status)) throw new Error('基线 Git 信息无效');
  if (git.status === 'available') {
    if (!Array.isArray(git.changes) || !git.changes.every(change => change && relativePath(change.path) &&
        typeof change.index === 'string' && /^[ MADRCUT?!]$/.test(change.index) && typeof change.worktree === 'string' && /^[ MADRCUT?!]$/.test(change.worktree))) throw new Error('基线 Git 改动无效');
  } else if (typeof git.message !== 'string') throw new Error('基线 Git 状态说明无效');
}

async function location(root: string, binding: ResultBinding, create: boolean): Promise<string> {
  if (!path.isAbsolute(root) || !binding || !uuid(binding.taskId) || !uuid(binding.operationId)) throw new Error('基线存储请求无效');
  const canonical = await fs.realpath(root);
  const folder = path.join(canonical, 'results');
  if (create) {
    try { await fs.mkdir(folder); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  const stat = await fs.lstat(folder);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(folder) !== folder) throw new Error('结果目录不是普通产品目录');
  return path.join(folder, `${binding.operationId}.baseline.json`);
}

export async function saveWorkspaceBaseline(root: string, binding: ResultBinding, snapshot: WorkspaceSnapshot, git: WorkspaceGitState): Promise<void> {
  const value: WorkspaceBaseline = { version: 1, taskId: binding.taskId, operationId: binding.operationId, snapshot, git };
  validate(value, binding);
  const json = JSON.stringify({ payload: value, sha256: digest(JSON.stringify(value)) });
  if (Buffer.byteLength(json) > maximumBytes) throw new Error('基线超过 64 MiB 保存上限，未确认保存');
  const filename = await location(root, binding, true);
  let file;
  try { file = await fs.open(filename, 'wx'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('当前操作的基线已存在，不覆盖原始记录');
    throw error;
  }
  try { await file.writeFile(json, 'utf8'); await file.sync(); }
  finally { await file.close(); }
}

export async function readWorkspaceBaseline(root: string, binding: ResultBinding): Promise<WorkspaceBaseline> {
  const filename = await location(root, binding, false), initial = await fs.lstat(filename);
  if (!initial.isFile() || initial.isSymbolicLink() || initial.size > maximumBytes) throw new Error('基线文件无效或超过读取上限');
  const file = await fs.open(filename, 'r');
  try {
    const before = await file.stat();
    if (before.dev !== initial.dev || before.ino !== initial.ino || before.size !== initial.size) throw new Error('基线读取期间发生变化');
    const buffer = Buffer.alloc(initial.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await file.stat();
    if (length !== initial.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('基线读取期间发生变化');
    let envelope;
    try { envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length))); }
    catch { throw new Error('基线未完整保存或已损坏，无法核对原始文件'); }
    if (!envelope?.payload || envelope.sha256 !== digest(JSON.stringify(envelope.payload))) throw new Error('基线校验失败，不能用于结果比较');
    validate(envelope.payload, binding);
    return envelope.payload;
  } finally { await file.close(); }
}
