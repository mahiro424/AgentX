const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
require('ts-node').register({ transpileOnly: true });

async function fixture() {
  const base = path.resolve('.local-validation/m2-01'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'archive-storage-'));
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  const project = associateProject(root, root).project, now = new Date().toISOString();
  const store = require('../../src/main/storage/tasks.ts');
  const task = { taskId: randomUUID(), projectId: project.projectId, directory: root, title: '合成归档记录',
    executionState: 'submitting', threadId: null, turnId: null, lastActivityAt: now, observedAt: now };
  const intent = { operationId: randomUUID(), text: '保留原始要求', modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID() };
  store.beginTaskSubmission(root, task, intent); store.markSubmissionDispatched(root, task.taskId, intent.operationId);
  store.bindSubmissionThread(root, task.taskId, intent.operationId, 'archive-thread');
  store.acknowledgeSubmission(root, task.taskId, intent.operationId, 'archive-thread', 'archive-turn');
  store.settleTaskTurn(root, task.taskId, intent.operationId, 'archive-thread', 'archive-turn', 'completed');
  const service = new (require('../../src/main/services/projects.ts').ProjectService)(root);
  return { root, store, service, task, intent, read: () => readWorkspace(root).tasks[0],
    request: { taskId: task.taskId, operationId: randomUUID(), expectedRevision: 0, archived: true } };
}

test('归档意图守卫：表面终态但仍有 prepared/sent/acknowledged/unknown 意图时拒绝归档', async () => {
  const f = await fixture(); const before = f.read();
  for (const phase of ['prepared', 'sent', 'acknowledged', 'unknown']) {
    const database = new DatabaseSync(path.join(f.root, 'agentx.db'));
    try { database.prepare('UPDATE execution_intents SET phase=?').run(phase); } finally { database.close(); }
    await assert.rejects(f.service.setTaskArchived(f.request), /未决发送/);
    assert.deepEqual(f.read(), before);
    assert.equal(f.store.readSubmissionIntent(f.root, f.intent.operationId).phase, phase);
  }
});

test('归档进程守卫：只检查本任务，根进程已关闭但后台未验证时仍拒绝，释放后可归档', async () => {
  const f = await fixture(); const before = f.read();
  const leases = require('../../src/main/storage/runtime-leases.ts');
  const lease = { leaseId: randomUUID(), instanceId: randomUUID(), taskId: f.task.taskId, operationId: randomUUID(), projectId: f.task.projectId,
    identity: { pid: 1234, parentPid: process.pid, createdAt: new Date().toISOString(), executablePath: path.resolve('synthetic-codex.exe') }, createdAt: new Date().toISOString() };
  leases.acquireRuntimeLease(f.root, lease); leases.markRuntimeWorkStarted(f.root, lease.leaseId, lease.instanceId);
  leases.recordRuntimeClosed(f.root, lease.leaseId, lease.instanceId, false);
  const pending = leases.readRuntimeLeases(f.root);
  await assert.rejects(f.service.setTaskArchived(f.request), /后台回收/);
  assert.deepEqual(f.read(), before); assert.deepEqual(leases.readRuntimeLeases(f.root), pending);
  leases.recordRuntimeClosed(f.root, lease.leaseId, lease.instanceId, true);
  const other = { ...lease, leaseId: randomUUID(), taskId: randomUUID(), operationId: randomUUID() };
  leases.acquireRuntimeLease(f.root, other);
  const saved = await f.service.setTaskArchived(f.request);
  assert.ok(saved.archivedAt); assert.equal(saved.lastActivityAt, before.lastActivityAt);
  assert.equal(leases.readRuntimeLeases(f.root).find(value => value.leaseId === other.leaseId).releasedAt, null);
});

test('归档边界：非法请求与陈旧修订不覆盖，归档阻止旧对象续轮，恢复只改组织', async () => {
  const f = await fixture(); const before = f.read();
  for (const value of [null, [], { ...f.request, archived: 'true' }, { ...f.request, taskId: 'invalid' },
    { ...f.request, operationId: 'invalid' }, { ...f.request, expectedRevision: -1 }, { ...f.request, expectedRevision: 0.5 },
    { ...f.request, expectedRevision: Number.MAX_SAFE_INTEGER + 1 }, { ...f.request, state: 'completed' }]) {
    await assert.rejects(f.service.setTaskArchived(value), /归档请求无效/); assert.deepEqual(f.read(), before);
  }
  const saved = await f.service.setTaskArchived(f.request);
  await assert.rejects(f.service.setTaskArchived(f.request), /已被其他操作更新/);
  assert.throws(() => f.store.beginTaskContinuation(f.root, before, { ...f.intent, operationId: randomUUID() }));
  assert.deepEqual(f.read(), saved);
  await assert.rejects(f.service.setTaskArchived({ ...f.request, archived: false }), /已被其他操作更新/);
  const restored = await f.service.setTaskArchived({ ...f.request, operationId: randomUUID(), expectedRevision: saved.organizationRevision, archived: false });
  assert.deepEqual({ ...restored, organizationRevision: before.organizationRevision }, before);
  assert.equal(f.store.readTaskSubmissionIntents(f.root, f.task.taskId).length, 1);
  assert.equal(f.store.readSubmissionIntent(f.root, f.intent.operationId).phase, 'settled');
});
