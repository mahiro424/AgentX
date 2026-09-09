import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export function withDatabase<T>(root: string, action: (database: DatabaseSync) => T): T {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path.join(root, 'agentx.db'));
    const version = database.prepare('PRAGMA user_version').get()?.user_version;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 0 || version > 14) throw new Error('unsupported-version');
    if (version === 0 && database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get()) throw new Error('unknown-schema');
    database.exec(`PRAGMA foreign_keys=${version < 13 ? 'OFF' : 'ON'}`);
    if (version < 14) {
      if (version > 0) database.prepare('VACUUM INTO ?').run(path.join(root, `agentx.before-v14.${randomUUID()}.db`));
      database.exec('BEGIN IMMEDIATE');
    }
    if (version === 0) {
      database.exec(`
        CREATE TABLE model_catalog (id INTEGER PRIMARY KEY CHECK(id=1), model_ids TEXT NOT NULL, fetched_at TEXT NOT NULL, config_revision INTEGER NOT NULL);
        PRAGMA user_version=1;
        `);
    }
    if (version === 0 || version === 1) {
      database.exec(`
        CREATE TABLE model_tests (operation_id TEXT PRIMARY KEY, model_id TEXT NOT NULL, config_revision INTEGER NOT NULL,
          credential_ref TEXT NOT NULL, tested_at TEXT NOT NULL, duration_ms INTEGER NOT NULL,
          outcome TEXT NOT NULL CHECK(outcome IN ('passed','failed')), error TEXT);
        PRAGMA user_version=2;
        `);
    }
    if (Number(version) < 3) {
      database.exec(`
        CREATE TABLE model_key_save (id INTEGER PRIMARY KEY CHECK(id=1), previous_ref TEXT);
        PRAGMA user_version=3;
        `);
    }
    if (Number(version) < 4) {
      database.exec(`
        CREATE TABLE projects (project_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, directory TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
        PRAGMA user_version=4;
        `);
    }
    if (Number(version) < 5) {
      database.exec(`
        CREATE TABLE tasks (task_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id), title TEXT NOT NULL,
          directory TEXT NOT NULL, created_at TEXT NOT NULL, last_activity_at TEXT NOT NULL, observed_at TEXT NOT NULL,
          execution_state TEXT NOT NULL, thread_id TEXT UNIQUE, turn_id TEXT);
        PRAGMA user_version=5;
        `);
    }
    if (Number(version) < 6) {
      database.exec(`
        CREATE TABLE execution_intents (operation_id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(task_id),
          input_text TEXT NOT NULL, model_id TEXT NOT NULL, config_revision INTEGER NOT NULL CHECK(config_revision >= 0),
          credential_ref TEXT NOT NULL, created_at TEXT NOT NULL,
          phase TEXT NOT NULL CHECK(phase IN ('prepared','sent','acknowledged','unknown','settled')));
        PRAGMA user_version=6;
      `);
    }
    if (Number(version) < 7) {
      database.exec(`CREATE TABLE drafts (scope_key TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(project_id),
        task_id TEXT REFERENCES tasks(task_id), input_text TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision >= 1));
        PRAGMA user_version=7;`);
    }
    if (version < 8) {
      database.exec(`ALTER TABLE execution_intents ADD COLUMN turn_id TEXT;
        CREATE UNIQUE INDEX execution_intents_turn ON execution_intents(task_id, turn_id) WHERE turn_id IS NOT NULL;
        PRAGMA user_version=8;`);
    }
    if (version < 9) {
      database.exec(`CREATE TABLE runtime_leases (lease_id TEXT PRIMARY KEY, instance_id TEXT NOT NULL,
        task_id TEXT NOT NULL, operation_id TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL REFERENCES projects(project_id),
        process_identity TEXT NOT NULL, created_at TEXT NOT NULL, work_started INTEGER NOT NULL DEFAULT 0 CHECK(work_started IN (0,1)),
        root_closed_at TEXT, released_at TEXT);
        PRAGMA user_version=9;`);
    }
    if (version < 10) {
      database.exec(`ALTER TABLE tasks ADD COLUMN organization_revision INTEGER NOT NULL DEFAULT 0 CHECK(organization_revision >= 0);
        PRAGMA user_version=10;`);
    }
    if (version < 11) {
      database.exec(`ALTER TABLE tasks ADD COLUMN pinned_at TEXT;
        PRAGMA user_version=11;`);
    }
    if (version < 12) {
      database.exec(`ALTER TABLE tasks ADD COLUMN archived_at TEXT;
        PRAGMA user_version=12;`);
    }
    if (version < 13) {
      // 重建可空关联表时暂时关闭外键；提交前核对全部引用，不改写或丢弃旧任务。
      database.exec(`CREATE TABLE tasks_v13 (task_id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(project_id), title TEXT NOT NULL,
        directory TEXT NOT NULL, created_at TEXT NOT NULL, last_activity_at TEXT NOT NULL, observed_at TEXT NOT NULL,
        execution_state TEXT NOT NULL, thread_id TEXT UNIQUE, turn_id TEXT,
        organization_revision INTEGER NOT NULL DEFAULT 0 CHECK(organization_revision >= 0), pinned_at TEXT, archived_at TEXT);
        INSERT INTO tasks_v13 SELECT * FROM tasks;
        DROP TABLE tasks; ALTER TABLE tasks_v13 RENAME TO tasks;
        CREATE TABLE runtime_leases_v13 (lease_id TEXT PRIMARY KEY, instance_id TEXT NOT NULL,
        task_id TEXT NOT NULL, operation_id TEXT NOT NULL UNIQUE, project_id TEXT REFERENCES projects(project_id),
        process_identity TEXT NOT NULL, created_at TEXT NOT NULL, work_started INTEGER NOT NULL DEFAULT 0 CHECK(work_started IN (0,1)),
        root_closed_at TEXT, released_at TEXT);
        INSERT INTO runtime_leases_v13 SELECT * FROM runtime_leases;
        DROP TABLE runtime_leases; ALTER TABLE runtime_leases_v13 RENAME TO runtime_leases;`);
      database.exec('PRAGMA user_version=13;');
    }
    if (version < 14) {
      database.exec(`CREATE TABLE materials (material_id TEXT PRIMARY KEY, record TEXT NOT NULL);
        CREATE TABLE input_materials (operation_id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(task_id),
          turn_id TEXT, draft_revision INTEGER NOT NULL CHECK(draft_revision >= 0), material_ids TEXT NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('turn','steer')), acknowledged INTEGER NOT NULL DEFAULT 0 CHECK(acknowledged IN (0,1)));
        ALTER TABLE drafts ADD COLUMN material_ids TEXT NOT NULL DEFAULT '[]';
        PRAGMA user_version=14;`);
      if (database.prepare('PRAGMA foreign_key_check').get()) throw new Error('invalid-migration-references');
      database.exec('COMMIT; PRAGMA foreign_keys=ON;');
    }
    return action(database);
  } catch (cause) {
    const code = (cause as { errcode?: number }).errcode;
    const kind = typeof code === 'number' ? code & 255 : null;
    const reasons: Record<number, string> = { 5: '数据库正在被占用', 6: '数据库已锁定', 8: '数据库为只读', 11: '数据库损坏', 14: '无法打开数据库文件', 19: '数据约束冲突', 26: '文件不是有效数据库' };
    const reason = cause instanceof Error && cause.message === 'unsupported-version' ? '数据库版本不受支持' :
      cause instanceof Error && cause.message === 'runtime-lease-pending' ? '仍有引擎归属及后台回收待核对，禁止创建新执行' :
      cause instanceof Error && cause.message === 'task-archive-blocked' ? '会话仍有活动执行、未决发送或后台回收待核对，请先停止或核对，不能归档' :
      cause instanceof Error && cause.message === 'task-archived' ? '会话已归档，请先显式恢复，不能自动执行' :
      cause instanceof Error && cause.message === 'invalid-draft-revision' ? '草稿已被其他操作更新，请先核对保存版本' :
      cause instanceof Error && /^(invalid-|unknown-schema)/u.test(cause.message) ? '产品记录格式或关联无效' :
      kind !== null && reasons[kind] ? reasons[kind] : '请检查产品数据库权限、格式和迁移记录';
    throw new Error(`产品元数据读取或写入失败：${reason}；不会清空重建${typeof code === 'number' ? `（SQLite ${code}）` : ''}`);
  }
  finally { database?.close(); }
}
