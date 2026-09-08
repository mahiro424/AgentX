const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
require('ts-node').register({ transpileOnly: true });

test('草稿存储：按项目和会话隔离，重新读取保留文本，过期写入不得覆盖', async () => {
  const { readDraft, saveDraft } = require('../../src/main/storage/drafts.ts');
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  const { createTaskRecord } = require('../../src/main/storage/tasks.ts');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-04/drafts-'));
  const project = associateProject(root, root).project;
  const now = new Date().toISOString(), taskId = randomUUID();
  createTaskRecord(root, { taskId, projectId: project.projectId, directory: root, title: '已有会话',
    lastActivityAt: now, observedAt: now, executionState: 'completed', threadId: 'existing-thread', turnId: 'existing-turn' });
  const scopes = [{ projectId: null, taskId: null }, { projectId: project.projectId, taskId: null }, { projectId: project.projectId, taskId }];
  for (const [i, scope] of scopes.entries()) {
    assert.deepEqual(readDraft(root, scope), { ...scope, text: '', revision: 0 });
    assert.deepEqual(saveDraft(root, { ...scope, text: `草稿 ${i}\n保留换行`, expectedRevision: 0 }), { ...scope, text: `草稿 ${i}\n保留换行`, revision: 1 });
  }
  for (const [i, scope] of scopes.entries()) assert.equal(readDraft(root, scope).text, `草稿 ${i}\n保留换行`);
  assert.throws(() => saveDraft(root, { ...scopes[1], text: '过期覆盖', expectedRevision: 0 }), /草稿|记录/);
  assert.equal(readDraft(root, scopes[1]).text, '草稿 1\n保留换行');
  assert.throws(() => readDraft(root, { projectId: null, taskId }), /草稿|关联/);
  assert.throws(() => readDraft(root, { projectId: randomUUID(), taskId }), /草稿|记录/);
  assert.throws(() => saveDraft(root, { ...scopes[0], text: 'x\0y', expectedRevision: 1 }), /草稿/);
  assert.equal(saveDraft(root, { ...scopes[1], text: '', expectedRevision: 1 }).revision, 2);
  assert.equal(readWorkspace(root).tasks.length, 1);
});

test('草稿迁移：v6 一致性备份保留发送意图，新表创建后原任务不丢失', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const { readDraft } = require('../../src/main/storage/drafts.ts');
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-04/draft-migration-'));
  const project = associateProject(root, root).project;
  const previous = new DatabaseSync(path.join(root, 'agentx.db'));
  try { previous.exec('DROP TABLE runtime_leases; DROP TABLE drafts; DROP INDEX execution_intents_turn; ALTER TABLE execution_intents DROP COLUMN turn_id; PRAGMA user_version=6'); } finally { previous.close(); }
  assert.equal(readDraft(root, { projectId: project.projectId, taskId: null }).revision, 0);
  assert.deepEqual(readWorkspace(root).projects, [project]);
  const backups = (await fs.readdir(root)).filter(name => /^agentx\.before-v9\..+\.db$/.test(name));
  assert.equal(backups.length, 1);
  const saved = new DatabaseSync(path.join(root, backups[0]), { readOnly: true });
  try {
    assert.equal(saved.prepare('PRAGMA user_version').get().user_version, 6);
    assert.equal(saved.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='drafts'").get().n, 0);
    assert.equal(saved.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='execution_intents'").get().n, 1);
    assert.equal(saved.prepare('SELECT project_id FROM projects').get().project_id, project.projectId);
  } finally { saved.close(); }
});
