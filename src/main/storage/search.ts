import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { TaskSearchTarget } from '../../shared/contracts/search';

export interface SearchTextRecord {
  taskId: string; threadId: string; turnId: string; itemId: string;
  kind: string; visibleText: string; sourceRevision: string;
}
export interface SearchTaskCoverage { taskId: string; taskRevision: string; indexedAt: string | null; error: string | null; partialReason: string | null }

function withSearchDatabase<T>(root: string, action: (database: DatabaseSync) => T): T {
  let database: DatabaseSync | undefined;
  try {
    const directory = path.join(root, 'cache');
    fs.mkdirSync(directory, { recursive: true });
    database = new DatabaseSync(path.join(directory, 'search.sqlite'));
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
    return action(database);
  } catch (cause) {
    const code = (cause as { errcode?: number }).errcode;
    // 不把索引文件或原始文本带入错误；损坏不能通过自动清库伪装成功。
    throw new Error(`搜索索引读取或写入失败，请检查缓存权限、格式或重试重建${typeof code === 'number' ? `（SQLite ${code}）` : ''}`);
  } finally { database?.close(); }
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

export function findSearchText(root: string, query: string): SearchTextRecord[] {
  return withSearchDatabase(root, database => database.prepare(`SELECT * FROM search_items
    WHERE instr(lower(visible_text), lower(?)) > 0 ORDER BY task_id, ordinal`).all(query).map(row => ({
    taskId: row.task_id as string, threadId: row.thread_id as string, turnId: row.turn_id as string,
    itemId: row.item_id as string, kind: row.kind as string, visibleText: row.visible_text as string,
    sourceRevision: row.source_revision as string,
  })));
}

export function hasSearchSource(root: string, source: TaskSearchTarget): boolean {
  return withSearchDatabase(root, database => Boolean(database.prepare(`SELECT 1 FROM search_items WHERE task_id=?
    AND thread_id=? AND turn_id=? AND item_id=? AND source_revision=?`).get(source.taskId, source.threadId,
    source.turnId, source.itemId, source.sourceRevision)));
}
