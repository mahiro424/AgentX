const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
require('ts-node').register({ transpileOnly: true });

// 冻结 M2-01 的有数据 v12 结构，不能用新版建库函数伪装旧版迁移输入。
async function v12(corrupt = false, independent = false) {
  const base = path.resolve('.local-validation/m2-02'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'v12-')), filename = path.join(root, 'agentx.db');
  const projectId = randomUUID(), taskId = randomUUID(), operationId = randomUUID(), leaseId = randomUUID(), instanceId = randomUUID();
  const now = new Date().toISOString(), scope = { projectId: independent ? null : projectId, taskId };
  const directory = independent ? path.join(root, 'workspaces', taskId) : root;
  const identity = { pid: 1234, parentPid: process.pid, createdAt: now, executablePath: path.join(root, 'fixture-codex.exe') };
  const db = new DatabaseSync(filename);
  try {
    if (corrupt) db.exec('PRAGMA foreign_keys=OFF');
    db.exec(`CREATE TABLE projects (project_id TEXT PRIMARY KEY,display_name TEXT NOT NULL,directory TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE tasks (task_id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(project_id),title TEXT NOT NULL,directory TEXT NOT NULL,
      created_at TEXT NOT NULL,last_activity_at TEXT NOT NULL,observed_at TEXT NOT NULL,execution_state TEXT NOT NULL,thread_id TEXT UNIQUE,turn_id TEXT,
      organization_revision INTEGER NOT NULL DEFAULT 0 CHECK(organization_revision>=0),pinned_at TEXT,archived_at TEXT);
      CREATE TABLE execution_intents (operation_id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(task_id),input_text TEXT NOT NULL,
      model_id TEXT NOT NULL,config_revision INTEGER NOT NULL CHECK(config_revision>=0),credential_ref TEXT NOT NULL,created_at TEXT NOT NULL,
      phase TEXT NOT NULL CHECK(phase IN ('prepared','sent','acknowledged','unknown','settled')),turn_id TEXT);
      CREATE UNIQUE INDEX execution_intents_turn ON execution_intents(task_id,turn_id) WHERE turn_id IS NOT NULL;
      CREATE TABLE drafts (scope_key TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(project_id),task_id TEXT REFERENCES tasks(task_id),input_text TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>=1));
      CREATE TABLE runtime_leases (lease_id TEXT PRIMARY KEY,instance_id TEXT NOT NULL,task_id TEXT NOT NULL,operation_id TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL REFERENCES projects(project_id),process_identity TEXT NOT NULL,created_at TEXT NOT NULL,
      work_started INTEGER NOT NULL DEFAULT 0 CHECK(work_started IN (0,1)),root_closed_at TEXT,released_at TEXT);
      PRAGMA user_version=12;`.replaceAll('project_id TEXT NOT NULL REFERENCES', independent ? 'project_id TEXT REFERENCES' : 'project_id TEXT NOT NULL REFERENCES')
      .replace('user_version=12', independent ? 'user_version=13' : 'user_version=12'));
    db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run(projectId,'旧项目',root,now,4);
    db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(taskId,corrupt ? randomUUID() : scope.projectId,'旧会话',directory,now,now,now,'completed','v12-thread','v12-turn',7,now,null);
    db.prepare('INSERT INTO execution_intents VALUES(?,?,?,?,?,?,?,?,?)').run(operationId,taskId,'原始任务要求','deepseek-v4-flash',3,randomUUID(),now,'settled','v12-turn');
    db.prepare('INSERT INTO drafts VALUES(?,?,?,?,?)').run(JSON.stringify([scope.projectId,taskId]),scope.projectId,taskId,'尚未发送的修改',9);
    db.prepare('INSERT INTO runtime_leases VALUES(?,?,?,?,?,?,?,?,?,?)').run(leaseId,instanceId,taskId,operationId,scope.projectId,JSON.stringify(identity),now,1,now,now);
  } finally { db.close(); }
  return { root, filename, projectId, taskId, operationId, leaseId, scope, now, identity };
}

test('v12→v14：有数据的项目、组织修订、草稿、意图和租约完整保留，备份仍可读', async () => {
  const f = await v12();
  const { readWorkspace } = require('../../src/main/storage/projects.ts');
  const { readDraft } = require('../../src/main/storage/drafts.ts');
  const { readTurnOperation, readSubmissionIntent } = require('../../src/main/storage/tasks.ts');
  const { readRuntimeLeases } = require('../../src/main/storage/runtime-leases.ts');
  const workspace = readWorkspace(f.root), task = workspace.tasks[0];
  assert.equal(workspace.projects[0].revision,4); assert.equal(task.organizationRevision,7);
  assert.equal(task.pinnedAt,f.now); assert.equal(task.directory,f.root); assert.equal(task.threadId,'v12-thread');
  assert.deepEqual(readDraft(f.root,f.scope),{...f.scope,text:'尚未发送的修改',revision:9,materials:[]});
  assert.equal(readTurnOperation(f.root,f.taskId,'v12-turn'),f.operationId);
  assert.equal(readSubmissionIntent(f.root,f.operationId).text,'原始任务要求');
  assert.deepEqual(readRuntimeLeases(f.root)[0].identity,f.identity);
  const backups=(await fs.readdir(f.root)).filter(name=>/^agentx\.before-v14\..+\.db$/.test(name)); assert.equal(backups.length,1);
  const before=new DatabaseSync(path.join(f.root,backups[0]),{readOnly:true});
  try { assert.equal(before.prepare('PRAGMA user_version').get().user_version,12); assert.equal(before.prepare('SELECT organization_revision FROM tasks').get().organization_revision,7); }
  finally {before.close();}
  const after=new DatabaseSync(f.filename,{readOnly:true});
  try { assert.equal(after.prepare('PRAGMA user_version').get().user_version,14); assert.deepEqual(after.prepare('PRAGMA foreign_key_check').all(),[]); }
  finally {after.close();}
});

test('v13→v14：已使用的非项目任务、草稿和历史关联不丢失，迁移前备份保留可空关联', async () => {
  const f = await v12(false, true);
  const { readWorkspace } = require('../../src/main/storage/projects.ts');
  const { readDraft } = require('../../src/main/storage/drafts.ts');
  const { readTurnOperation } = require('../../src/main/storage/tasks.ts');
  const task = readWorkspace(f.root).tasks[0];
  assert.equal(task.projectId, null); assert.equal(task.threadId, 'v12-thread');
  assert.deepEqual(readDraft(f.root, f.scope), { ...f.scope, text: '尚未发送的修改', revision: 9, materials: [] });
  assert.equal(readTurnOperation(f.root, f.taskId, 'v12-turn'), f.operationId);
  const backups = (await fs.readdir(f.root)).filter(name => name.startsWith('agentx.before-v14.'));
  assert.equal(backups.length, 1);
  const before = new DatabaseSync(path.join(f.root, backups[0]), { readOnly: true });
  try { assert.equal(before.prepare('PRAGMA user_version').get().user_version, 13); assert.equal(before.prepare('SELECT project_id FROM tasks').get().project_id, null); }
  finally { before.close(); }
});

test('v12 引用损坏：迁移失败保留旧库和备份，不清库、不提交半次表重建', async () => {
  const f=await v12(true), hash=async()=>createHash('sha256').update(await fs.readFile(f.filename)).digest('hex');
  const before=await hash();
  assert.throws(()=>require('../../src/main/storage/projects.ts').readWorkspace(f.root),/不会清空重建/);
  assert.equal(await hash(),before);
  const db=new DatabaseSync(f.filename,{readOnly:true});
  try {assert.equal(db.prepare('PRAGMA user_version').get().user_version,12); assert.equal(db.prepare('SELECT count(*) AS n FROM tasks').get().n,1);}
  finally {db.close();}
  assert.equal((await fs.readdir(f.root)).filter(name=>name.startsWith('agentx.before-v14.')).length,1);
});
