import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ArtifactReference } from '../../shared/contracts/artifacts';
import { workspaceFileLimit } from '../services/workspace-results';

export interface ArtifactRecord extends ArtifactReference { version: 1; directory: string }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const idFor = (value: Omit<ArtifactRecord, 'resultId'>) => hash(JSON.stringify([value.taskId, value.threadId, value.turnId,
  value.operationId, value.directory, value.path, value.size, value.sha256]));
const maximumBytes = 256 * 1024;

function validate(value: ArtifactRecord, taskId: string, resultId: string) {
  if (!value || Object.keys(value).length !== 11 || value.version !== 1 || value.taskId !== taskId || !uuid(taskId) || !uuid(value.operationId) ||
    !text(value.threadId, 512) || !text(value.turnId, 512) || !text(value.directory, 32767) || !path.isAbsolute(value.directory) ||
    !text(value.path, 32767) || /[\\:]/u.test(value.path) || value.path.split('/').some(part => !part || part === '.' || part === '..') ||
    !['.txt', '.md', '.markdown', '.csv', '.xlsx', '.docx', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(path.extname(value.path).toLowerCase()) ||
    !Number.isSafeInteger(value.size) || value.size < 0 || value.size > workspaceFileLimit(value.path) || !sha(value.sha256) ||
    !text(value.observedAt, 40) || !Number.isFinite(Date.parse(value.observedAt)) ||
    value.resultId !== resultId || !sha(resultId) || idFor(value) !== resultId) throw new Error('产物引用损坏或归属不匹配，未读取替代文件');
}

async function location(root: string, taskId: string, create: boolean) {
  if (!path.isAbsolute(root) || !uuid(taskId)) throw new Error('产物任务标识无效');
  const canonical = await fs.realpath(root), results = path.join(canonical, 'results'), directory = path.join(results, taskId);
  for (const folder of [results, directory]) {
    if (create) {
      try { await fs.mkdir(folder); }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause; }
    }
    const stat = await fs.lstat(folder);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(folder) !== folder) throw new Error('产物引用目录已变化');
  }
  return directory;
}

async function readRecord(directory: string, taskId: string, resultId: string): Promise<ArtifactRecord> {
  if (!sha(resultId)) throw new Error('产物结果标识无效');
  const filename = path.join(directory, `${resultId}.json`), initial = await fs.lstat(filename);
  if (!initial.isFile() || initial.isSymbolicLink() || initial.size > maximumBytes || await fs.realpath(filename) !== filename) throw new Error('产物引用文件无效或超限');
  const file = await fs.open(filename, 'r');
  try {
    const before = await file.stat(), buffer = Buffer.alloc(initial.size + 1);
    if (before.dev !== initial.dev || before.ino !== initial.ino || before.size !== initial.size) throw new Error('产物引用读取期间变化');
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await file.stat();
    if (length !== initial.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || await fs.realpath(filename) !== filename) throw new Error('产物引用读取期间变化');
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length))); }
    catch { throw new Error('产物引用未完整保存或已损坏'); }
    if (!value?.payload || value.sha256 !== hash(JSON.stringify(value.payload))) throw new Error('产物引用校验失败');
    validate(value.payload, taskId, resultId);
    return value.payload;
  } finally { await file.close(); }
}

export async function readArtifact(root: string, taskId: string, resultId: string) {
  return readRecord(await location(root, taskId, false), taskId, resultId);
}

export async function saveArtifact(root: string, input: Omit<ArtifactRecord, 'version' | 'resultId'>) {
  const value: ArtifactRecord = { ...input, version: 1, resultId: idFor({ ...input, version: 1 }) };
  validate(value, value.taskId, value.resultId);
  const directory = await location(root, value.taskId, true), filename = path.join(directory, `${value.resultId}.json`);
  const json = JSON.stringify({ payload: value, sha256: hash(JSON.stringify(value)) });
  if (Buffer.byteLength(json) > maximumBytes) throw new Error('产物引用超过保存上限');
  let file;
  try { file = await fs.open(filename, 'wx'); }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
    // 同一观察版本只保存一次；读取并校验已有记录，不覆盖它的首次观察时间。
    return readRecord(directory, value.taskId, value.resultId);
  }
  try { await file.writeFile(json, 'utf8'); await file.sync(); }
  finally { await file.close(); }
  return value;
}

export async function listArtifacts(root: string, taskId: string): Promise<ArtifactRecord[]> {
  let directory: string;
  try { directory = await location(root, taskId, false); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []; throw cause; }
  const records: ArtifactRecord[] = [];
  let bytes = 0;
  for await (const entry of await fs.opendir(directory)) {
    if (!/^[a-f0-9]{64}\.json$/.test(entry.name) || !entry.isFile()) throw new Error('产物引用目录包含无法核对的记录');
    if (records.length >= 10000) throw new Error('产物版本超过本阶段 10000 条读取上限');
    const value = await readRecord(directory, taskId, entry.name.slice(0, -5));
    bytes += Buffer.byteLength(JSON.stringify(value));
    if (bytes > 16 * 1024 * 1024) throw new Error('产物引用超过本阶段 16 MiB 读取上限');
    records.push(value);
  }
  return records.sort((left, right) => right.observedAt.localeCompare(left.observedAt) || left.resultId.localeCompare(right.resultId));
}
