const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
require('ts-node').register({ transpileOnly: true });

test('轮次落盘：错误操作或 thread 不能确认任务，失败不留下半条绑定', async () => {
  const { beginTaskSubmission, markSubmissionDispatched, bindSubmissionThread, acknowledgeSubmission, readSubmissionIntent } = require('../../src/main/storage/tasks.ts');
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-04/submission-binding-'));
  const project = associateProject(root, root).project, time = new Date().toISOString();
  const task = { taskId: randomUUID(), projectId: project.projectId, title: '核对关联', directory: root,
    lastActivityAt: time, observedAt: time, executionState: 'submitting', threadId: null, turnId: null };
  const intent = { operationId: randomUUID(), text: '原始要求', modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID() };
  beginTaskSubmission(root, task, intent); markSubmissionDispatched(root, task.taskId, intent.operationId);
  assert.throws(() => bindSubmissionThread(root, task.taskId, randomUUID(), 'wrong-thread'));
  assert.equal(readWorkspace(root).tasks[0].threadId, null);
  bindSubmissionThread(root, task.taskId, intent.operationId, 'thread-1');
  assert.throws(() => bindSubmissionThread(root, task.taskId, intent.operationId, 'thread-2'));
  assert.throws(() => acknowledgeSubmission(root, task.taskId, intent.operationId, 'thread-2', 'turn-1'));
  assert.throws(() => acknowledgeSubmission(root, task.taskId, randomUUID(), 'thread-1', 'turn-1'));
  assert.deepEqual(readWorkspace(root).tasks, [{ ...task, threadId: 'thread-1' }]);
  assert.equal(readSubmissionIntent(root, intent.operationId).phase, 'sent');
  acknowledgeSubmission(root, task.taskId, intent.operationId, 'thread-1', 'turn-1');
  assert.equal(readSubmissionIntent(root, intent.operationId).phase, 'acknowledged');
  assert.deepEqual(readWorkspace(root).tasks, [{ ...task, executionState: 'running', threadId: 'thread-1', turnId: 'turn-1' }]);
});

test('发送后失联：意图与任务原子进入核对，旧操作不能重新发送或改写其他任务', async () => {
  const { beginTaskSubmission, readSubmissionIntent, markSubmissionDispatched, markSubmissionUncertain } = require('../../src/main/storage/tasks.ts');
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  const base = path.resolve('.local-validation/m1-04'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'submission-uncertain-'));
  const project = associateProject(root, root).project, time = new Date().toISOString();
  const task = { taskId: randomUUID(), projectId: project.projectId, title: '失联核对', directory: root,
    lastActivityAt: time, observedAt: time, executionState: 'submitting', threadId: null, turnId: null };
  const intent = { operationId: randomUUID(), text: '修复合成项目', modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID() };
  beginTaskSubmission(root, task, intent);
  assert.throws(() => markSubmissionDispatched(root, randomUUID(), intent.operationId));
  assert.equal(readSubmissionIntent(root, intent.operationId).phase, 'prepared');
  markSubmissionDispatched(root, task.taskId, intent.operationId);
  assert.equal(readSubmissionIntent(root, intent.operationId).phase, 'sent');
  assert.throws(() => markSubmissionDispatched(root, task.taskId, intent.operationId));
  assert.throws(() => markSubmissionUncertain(root, task.taskId, intent.operationId, new Date(Date.parse(time) - 1000).toISOString()));
  assert.equal(readSubmissionIntent(root, intent.operationId).phase, 'sent');
  assert.deepEqual(readWorkspace(root).tasks, [task]);
  const observedAt = new Date(Date.parse(time) + 1000).toISOString();
  markSubmissionUncertain(root, task.taskId, intent.operationId, observedAt);
  assert.equal(readSubmissionIntent(root, intent.operationId).phase, 'unknown');
  assert.deepEqual(readWorkspace(root).tasks, [{ ...task, executionState: 'reconciling', observedAt }]);
  assert.throws(() => markSubmissionDispatched(root, task.taskId, intent.operationId));
  assert.equal(readSubmissionIntent(root, intent.operationId).text, intent.text);
});

test('发送意图：任务与输入一并保存，重读可恢复关联且不落模型密钥', async () => {
  const { beginTaskSubmission, readSubmissionIntent } = require('../../src/main/storage/tasks.ts');
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  const base = path.resolve('.local-validation/m1-04'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'submission-'));
  const project = associateProject(root, root).project;
  const time = new Date().toISOString();
  const task = { taskId: randomUUID(), projectId: project.projectId, title: '修复合成项目', directory: root,
    lastActivityAt: time, observedAt: time, executionState: 'submitting', threadId: null, turnId: null };
  const intent = { operationId: randomUUID(), text: '修复两个文件\n并运行测试', modelId: 'deepseek-v4-flash', configRevision: 3, credentialRef: randomUUID() };
  beginTaskSubmission(root, task, { ...intent, apiKey: 'synthetic-must-not-persist' });
  assert.deepEqual(readWorkspace(root).tasks, [task]);
  assert.deepEqual(readSubmissionIntent(root, intent.operationId), { ...intent, taskId: task.taskId, phase: 'prepared' });
  assert.equal((await fs.readFile(path.join(root, 'agentx.db'))).includes(Buffer.from('synthetic-must-not-persist')), false);
});

test('发送意图：重复操作不留下第二个任务，原始意图不被替换', async () => {
  const { beginTaskSubmission, readSubmissionIntent } = require('../../src/main/storage/tasks.ts');
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  const base = path.resolve('.local-validation/m1-04'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'submission-duplicate-'));
  const project = associateProject(root, root).project, time = new Date().toISOString();
  const task = { taskId: randomUUID(), projectId: project.projectId, title: '首次提交', directory: root,
    lastActivityAt: time, observedAt: time, executionState: 'submitting', threadId: null, turnId: null };
  const intent = { operationId: randomUUID(), text: '原始要求', modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID() };
  beginTaskSubmission(root, task, intent);
  assert.throws(() => beginTaskSubmission(root, { ...task, taskId: randomUUID() }, { ...intent, text: '不得替换原要求' }), /数据约束冲突/);
  assert.deepEqual(readWorkspace(root).tasks, [task]);
  assert.equal(readSubmissionIntent(root, intent.operationId).text, '原始要求');
});

test('发送意图迁移：v5 项目保留，升级前快照仍是可读取的 v5', async () => {
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  const { DatabaseSync } = require('node:sqlite');
  const base = path.resolve('.local-validation/m1-04'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'submission-migration-'));
  const project = associateProject(root, root).project;
  const previous = new DatabaseSync(path.join(root, 'agentx.db'));
  try { previous.exec('DROP TABLE drafts; DROP TABLE execution_intents; PRAGMA user_version=5'); } finally { previous.close(); }
  assert.deepEqual(readWorkspace(root).projects, [project]);
  const backups = (await fs.readdir(root)).filter(name => /^agentx\.before-v7\..+\.db$/.test(name));
  assert.equal(backups.length, 1);
  const backup = new DatabaseSync(path.join(root, backups[0]), { readOnly: true });
  try {
    assert.equal(backup.prepare('PRAGMA user_version').get().user_version, 5);
    assert.equal(backup.prepare('SELECT project_id FROM projects').get().project_id, project.projectId);
    assert.equal(backup.prepare("SELECT 1 FROM sqlite_master WHERE name='execution_intents'").get(), undefined);
  } finally { backup.close(); }
  const current = new DatabaseSync(path.join(root, 'agentx.db'), { readOnly: true });
  try { assert.equal(current.prepare('PRAGMA user_version').get().user_version, 7); }
  finally { current.close(); }
});
