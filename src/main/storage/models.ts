import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ModelCatalog, ModelTestResult } from '../../shared/contracts/models';

function withDatabase<T>(root: string, action: (database: DatabaseSync) => T): T {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path.join(root, 'agentx.db'));
    const version = database.prepare('PRAGMA user_version').get()?.user_version;
    if (version === 0) {
      if (database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get()) throw new Error('unknown-schema');
      database.exec(`BEGIN;
        CREATE TABLE model_catalog (id INTEGER PRIMARY KEY CHECK(id=1), model_ids TEXT NOT NULL, fetched_at TEXT NOT NULL, config_revision INTEGER NOT NULL);
        PRAGMA user_version=1;
        COMMIT;`);
    } else if (version !== 1 && version !== 2 && version !== 3) { throw new Error('unsupported-version'); }
    if (version === 0 || version === 1) {
      database.exec(`BEGIN;
        CREATE TABLE model_tests (operation_id TEXT PRIMARY KEY, model_id TEXT NOT NULL, config_revision INTEGER NOT NULL,
          credential_ref TEXT NOT NULL, tested_at TEXT NOT NULL, duration_ms INTEGER NOT NULL,
          outcome TEXT NOT NULL CHECK(outcome IN ('passed','failed')), error TEXT);
        PRAGMA user_version=2;
        COMMIT;`);
    }
    if (version !== 3) {
      database.exec(`BEGIN;
        CREATE TABLE model_key_save (id INTEGER PRIMARY KEY CHECK(id=1), previous_ref TEXT);
        PRAGMA user_version=3;
        COMMIT;`);
    }
    return action(database);
  } catch { throw new Error('模型元数据读取或写入失败，请检查产品数据库权限、格式和版本；不会清空重建'); }
  finally { database?.close(); }
}

export function readCatalog(root: string): ModelCatalog {
  if (!fs.existsSync(path.join(root, 'agentx.db'))) return { modelIds: [], fetchedAt: null, configRevision: null };
  return withDatabase(root, database => {
    const row = database.prepare('SELECT model_ids, fetched_at, config_revision FROM model_catalog WHERE id=1').get();
    if (!row) return { modelIds: [], fetchedAt: null, configRevision: null };
    const modelIds: unknown = JSON.parse(String(row.model_ids));
    if (!Array.isArray(modelIds) || modelIds.some(id => typeof id !== 'string')) throw new Error('invalid-catalog');
    return { modelIds, fetchedAt: String(row.fetched_at), configRevision: Number(row.config_revision) };
  });
}

export function writeCatalog(root: string, modelIds: string[], configRevision: number): void {
  withDatabase(root, database => {
    database.prepare(`INSERT INTO model_catalog VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET model_ids=excluded.model_ids, fetched_at=excluded.fetched_at, config_revision=excluded.config_revision`)
      .run(JSON.stringify(modelIds), new Date().toISOString(), configRevision);
  });
}

export interface StoredModelTest extends Omit<ModelTestResult, 'expired'> { credentialRef: string }

export function readModelTests(root: string): StoredModelTest[] {
  if (!fs.existsSync(path.join(root, 'agentx.db'))) return [];
  return withDatabase(root, database => database.prepare(`SELECT * FROM model_tests WHERE rowid IN
    (SELECT MAX(rowid) FROM model_tests GROUP BY model_id)`).all().map(row => ({
      operationId: String(row.operation_id), modelId: String(row.model_id), configRevision: Number(row.config_revision),
      credentialRef: String(row.credential_ref), testedAt: String(row.tested_at), durationMs: Number(row.duration_ms),
      outcome: row.outcome as 'passed' | 'failed', error: row.error === null ? null : String(row.error),
    })));
}

export function hasModelTest(root: string, operationId: string): boolean {
  if (!fs.existsSync(path.join(root, 'agentx.db'))) return false;
  return withDatabase(root, database => !!database.prepare('SELECT 1 FROM model_tests WHERE operation_id=?').get(operationId));
}

export function writeModelTest(root: string, value: StoredModelTest): void {
  withDatabase(root, database => {
    database.prepare('INSERT INTO model_tests VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(value.operationId, value.modelId,
      value.configRevision, value.credentialRef, value.testedAt, value.durationMs, value.outcome, value.error);
  });
}

export function finishModelTest(root: string, value: StoredModelTest): void {
  withDatabase(root, database => {
    const result = database.prepare(`UPDATE model_tests SET tested_at=?, duration_ms=?, outcome=?, error=?
      WHERE operation_id=? AND model_id=? AND config_revision=? AND credential_ref=?`).run(value.testedAt, value.durationMs,
        value.outcome, value.error, value.operationId, value.modelId, value.configRevision, value.credentialRef);
    if (result.changes !== 1) throw new Error('test-operation-missing');
  });
}

export function beginKeySave(root: string, previousReference: string | null): void {
  withDatabase(root, database => { database.prepare('INSERT INTO model_key_save VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET previous_ref=excluded.previous_ref').run(previousReference); });
}

export function finishKeySave(root: string): void {
  withDatabase(root, database => { database.prepare('DELETE FROM model_key_save WHERE id=1').run(); });
}

export function readKeySaveFailure(root: string, currentReference: string | null): string | null {
  if (!fs.existsSync(path.join(root, 'agentx.db'))) return null;
  return withDatabase(root, database => {
    const row = database.prepare('SELECT previous_ref FROM model_key_save WHERE id=1').get();
    // 配置引用已变化说明提交完成；崩溃前未能清理的标记不否认已落盘的事实。
    return row && row.previous_ref === currentReference ? '上次密钥保存失败或尚未确认，请重新提交完整密钥；不会使用旧 Key 发起请求' : null;
  });
}
