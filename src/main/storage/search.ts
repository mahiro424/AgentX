import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import type { TaskSearchTarget } from '../../shared/contracts/search';

export interface SearchTextRecord {
  taskId: string; threadId: string; turnId: string; itemId: string;
  kind: string; visibleText: string; sourceRevision: string;
}
export interface SearchTaskCoverage { taskId: string; taskRevision: string; indexedAt: string | null; error: string | null; partialReason: string | null }

export function validateSearchCache(root: string): string {
  const base = fs.realpathSync(root), directory = path.join(base, 'cache');
  const inspect = (file: string) => {
    try { return fs.lstatSync(file); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null; throw cause; }
  };
  const folder = inspect(directory);
  if (folder && (!folder.isDirectory() || folder.isSymbolicLink())) throw new Error('搜索缓存目录不是应用自有的普通目录');
  fs.mkdirSync(directory, { recursive: true });
  if (fs.realpathSync(directory) !== directory) throw new Error('搜索缓存目录发生重定向，已拒绝访问');
  const file = path.join(directory, 'search.sqlite');
  // SQLite 也会访问日志和共享内存；它们不能成为写入其他文件的链接入口。
  for (const candidate of [file, `${file}-journal`, `${file}-wal`, `${file}-shm`]) {
    const info = inspect(candidate);
    if (info && (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)) throw new Error('搜索缓存文件存在链接或类型异常，已拒绝访问');
  }
  return file;
}

// 只在用户显式重建时处理已确认损坏；权限、锁定和未知版本失败不能触发替换。
export function preserveDamagedSearchCache(root: string): boolean {
  const file = validateSearchCache(root);
  if (!fs.existsSync(file)) return false;
  let database: DatabaseSync | undefined, damaged = false;
  try {
    database = new DatabaseSync(file, { readOnly: true });
    const version = database.prepare('PRAGMA user_version').get()?.user_version;
    if (version !== 0 && version !== 1) throw new Error('搜索索引版本不受支持，未替换原文件');
    damaged = database.prepare('PRAGMA quick_check').all().some(row => row.quick_check !== 'ok');
    if (!damaged && version === 1) {
      try {
        database.prepare('SELECT task_id, thread_id, turn_id, item_id, kind, visible_text, source_revision, ordinal, indexed_at FROM search_items LIMIT 0').all();
        database.prepare('SELECT task_id, task_revision, indexed_at, error, partial_reason FROM search_coverage LIMIT 0').all();
      } catch (cause) {
        // 这些固定语句在 v1 必须成立；仅缺失表/列的 SQL 错误视为已知结构损坏。
        if ((cause as { errcode?: number }).errcode === 1) damaged = true;
        else throw cause;
      }
    }
  } catch (cause) {
    const code = (cause as { errcode?: number }).errcode;
    if (typeof code === 'number' && [11, 26].includes(code & 255)) damaged = true;
    else throw new Error(`无法核验搜索索引，原文件未替换${typeof code === 'number' ? `（SQLite ${code}）` : ''}`);
  } finally { database?.close(); }
  if (!damaged) return false;
  validateSearchCache(root);
  const preserved = path.join(path.dirname(file), `search.damaged-${randomUUID()}.sqlite`);
  const moved: [string, string][] = [];
  try {
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      const source = `${file}${suffix}`, target = `${preserved}${suffix}`;
      if (path.dirname(target) !== path.dirname(file) || fs.existsSync(target)) throw new Error('损坏索引保留位置无效');
      if (!fs.existsSync(source)) continue;
      fs.renameSync(source, target); moved.push([source, target]);
    }
  } catch {
    let restored = true;
    for (const [source, target] of moved.reverse()) {
      try { fs.renameSync(target, source); } catch { restored = false; }
    }
    throw new Error(restored ? '损坏索引保留失败，已恢复原位置；未开始重建' : '损坏索引保留失败，部分文件仍在缓存内的保留位置；请核对，未开始重建');
  }
  return true;
}

function searchDatabaseError(cause: unknown): Error {
  const code = (cause as { errcode?: number }).errcode;
  // 不把索引文件或原始文本带入错误；损坏不能通过自动清库伪装成功。
  return new Error(`搜索索引读取或写入失败，请检查缓存权限、格式或重试重建${typeof code === 'number' ? `（SQLite ${code}）` : ''}`);
}

function openSearchDatabase(root: string): DatabaseSync {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(validateSearchCache(root));
    const version = database.prepare('PRAGMA user_version').get()?.user_version;
    if (version !== 0 && version !== 1) throw new Error('搜索索引版本不受支持');
    if (version === 0) {
      if (database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get()) throw new Error('搜索索引结构不明确');
      database.exec(`BEGIN IMMEDIATE;
        CREATE TABLE search_items (task_id TEXT NOT NULL, thread_id TEXT NOT NULL, turn_id TEXT NOT NULL,
          item_id TEXT NOT NULL, kind TEXT NOT NULL, visible_text TEXT NOT NULL, source_revision TEXT NOT NULL,
          ordinal INTEGER NOT NULL, indexed_at TEXT NOT NULL, PRIMARY KEY (task_id, turn_id, item_id));
        CREATE TABLE search_coverage (task_id TEXT PRIMARY KEY, task_revision TEXT NOT NULL, indexed_at TEXT, error TEXT, partial_reason TEXT);
        PRAGMA user_version=1; COMMIT;`);
    }
    return database;
  } catch (cause) {
    database?.close(); throw searchDatabaseError(cause);
  }
}

function withSearchDatabase<T>(root: string, action: (database: DatabaseSync) => T): T {
  const database = openSearchDatabase(root);
  try { return action(database); }
  catch (cause) { throw searchDatabaseError(cause); }
  finally { database.close(); }
}

export function replaceSearchTask(root: string, coverage: SearchTaskCoverage, items: SearchTextRecord[]): void {
  withSearchDatabase(root, database => {
    database.exec('BEGIN IMMEDIATE');
    database.prepare('DELETE FROM search_items WHERE task_id=?').run(coverage.taskId);
    const insert = database.prepare('INSERT INTO search_items VALUES (?,?,?,?,?,?,?,?,?)');
    for (const [ordinal, item] of items.entries()) insert.run(item.taskId, item.threadId, item.turnId, item.itemId,
      item.kind, item.visibleText, item.sourceRevision, ordinal, coverage.indexedAt);
    database.prepare(`INSERT INTO search_coverage VALUES (?,?,?,NULL,?) ON CONFLICT(task_id)
      DO UPDATE SET task_revision=excluded.task_revision, indexed_at=excluded.indexed_at, error=NULL, partial_reason=excluded.partial_reason`)
      .run(coverage.taskId, coverage.taskRevision, coverage.indexedAt, coverage.partialReason);
    database.exec('COMMIT');
  });
}

export function markSearchUnavailable(root: string, taskId: string, taskRevision: string, error: string): void {
  withSearchDatabase(root, database => database.prepare(`INSERT INTO search_coverage VALUES (?,?,NULL,?,NULL) ON CONFLICT(task_id)
    DO UPDATE SET task_revision=excluded.task_revision, error=excluded.error`).run(taskId, taskRevision, error));
}

export function readSearchCoverage(root: string): SearchTaskCoverage[] {
  return withSearchDatabase(root, database => database.prepare('SELECT * FROM search_coverage').all().map(row => ({
    taskId: row.task_id as string, taskRevision: row.task_revision as string, indexedAt: row.indexed_at as string | null, error: row.error as string | null,
    partialReason: row.partial_reason as string | null,
  })));
}

export async function* readSearchText(root: string): AsyncGenerator<(SearchTextRecord & { ordinal: number })[]> {
  const database = openSearchDatabase(root);
  const changed = new Error('搜索期间索引已更新，请重新查询');
  try {
    // 同一连接的 data_version 检出其他写入者；不持有跨批次读事务阻塞实时索引。
    const version = database.prepare('PRAGMA data_version');
    const initialVersion = version.get()!.data_version;
    const verifyVersion = () => { if (version.get()!.data_version !== initialVersion) throw changed; };
    const fence = database.prepare('SELECT MAX(rowid) AS id FROM search_items').get()?.id as number | null;
    const read = database.prepare('SELECT rowid AS id, * FROM search_items WHERE rowid > ? AND rowid <= ? ORDER BY rowid LIMIT 256');
    let cursor = 0;
    while (fence !== null && cursor < fence) {
      verifyVersion();
      // 限制实际扫描行数，不能在 WHERE 匹配后才 LIMIT，否则无命中仍会同步扫描全库。
      const rows = read.all(cursor, fence);
      verifyVersion();
      if (!rows.length) break;
      cursor = rows.at(-1)!.id as number;
      yield rows.map(row => ({ taskId: row.task_id as string, threadId: row.thread_id as string, turnId: row.turn_id as string,
        itemId: row.item_id as string, kind: row.kind as string, visibleText: row.visible_text as string,
        sourceRevision: row.source_revision as string, ordinal: row.ordinal as number }));
      await setImmediate();
    }
    verifyVersion();
  } catch (cause) { throw cause === changed ? changed : searchDatabaseError(cause); }
  finally { database.close(); }
}

export function hasSearchSource(root: string, source: TaskSearchTarget): boolean {
  return withSearchDatabase(root, database => Boolean(database.prepare(`SELECT 1 FROM search_items WHERE task_id=?
    AND thread_id=? AND turn_id=? AND item_id=? AND source_revision=?`).get(source.taskId, source.threadId,
    source.turnId, source.itemId, source.sourceRevision)));
}
