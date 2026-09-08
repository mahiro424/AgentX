const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
require('ts-node').register({ transpileOnly: true });

test('引擎归属落盘：关闭根进程不等于后台已回收，未核实记录重读后仍占用执行槽', async () => {
  const store = require('../../src/main/storage/runtime-leases.ts');
  const { associateProject } = require('../../src/main/storage/projects.ts');
  await fs.mkdir(path.resolve('.local-validation/m1-06'), { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-06/runtime-lease-'));
  const project = associateProject(root, root).project;
  const lease = { leaseId: randomUUID(), instanceId: randomUUID(), taskId: randomUUID(), operationId: randomUUID(),
    projectId: project.projectId, createdAt: new Date().toISOString(),
    identity: { pid: 1234, parentPid: process.pid, createdAt: '2026-09-08T01:02:03.1234567Z', executablePath: path.resolve('synthetic-codex.exe') } };
  store.acquireRuntimeLease(root, lease);
  assert.deepEqual(store.readRuntimeLeases(root), [{ ...lease, workStarted: false, rootClosedAt: null, releasedAt: null }]);
  store.markRuntimeWorkStarted(root, lease.leaseId, lease.instanceId);
  store.recordRuntimeClosed(root, lease.leaseId, lease.instanceId, false);
  const retained = store.readRuntimeLeases(root)[0];
  assert.equal(retained.workStarted, true);
  assert.equal(typeof retained.rootClosedAt, 'string');
  assert.equal(retained.releasedAt, null);
  assert.throws(() => store.acquireRuntimeLease(root, { ...lease, leaseId: randomUUID(), operationId: randomUUID() }), /核对/);
  assert.throws(() => store.recordRuntimeClosed(root, lease.leaseId, randomUUID(), true));
  assert.deepEqual(store.readRuntimeLeases(root), [retained]);
  store.recordRuntimeClosed(root, lease.leaseId, lease.instanceId, true);
  assert.equal(typeof store.readRuntimeLeases(root)[0].releasedAt, 'string');
  assert.equal(store.readRuntimeLeases(root)[0].rootClosedAt, retained.rootClosedAt);
  assert.equal((await fs.readFile(path.join(root, 'agentx.db'))).includes(Buffer.from(lease.identity.createdAt)), true);
});

test('v8 升级保留任务与意图的精确关联，旧版本快照可读取，不伪造历史进程归属', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  const { beginTaskSubmission, readSubmissionIntent } = require('../../src/main/storage/tasks.ts');
  const { readRuntimeLeases } = require('../../src/main/storage/runtime-leases.ts');
  await fs.mkdir(path.resolve('.local-validation/m1-06'), { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-06/lease-migration-'));
  const project = associateProject(root, root).project, now = new Date().toISOString();
  const task = { taskId: randomUUID(), projectId: project.projectId, title: '原始未决任务', directory: root,
    lastActivityAt: now, observedAt: now, executionState: 'submitting', threadId: null, turnId: null };
  const intent = { operationId: randomUUID(), text: '保留原始要求', modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID() };
  beginTaskSubmission(root, task, intent);
  const database = new DatabaseSync(path.join(root, 'agentx.db'));
  try { database.exec('DROP TABLE runtime_leases; PRAGMA user_version=8'); } finally { database.close(); }
  assert.deepEqual(readRuntimeLeases(root), []);
  assert.deepEqual(readWorkspace(root).tasks, [task]);
  assert.deepEqual(readSubmissionIntent(root, intent.operationId), { ...intent, taskId: task.taskId, phase: 'prepared' });
  const backups = (await fs.readdir(root)).filter(name => /^agentx\.before-v9\..+\.db$/.test(name));
  assert.equal(backups.length, 1);
  const before = new DatabaseSync(path.join(root, backups[0]), { readOnly: true });
  try {
    assert.equal(before.prepare('PRAGMA user_version').get().user_version, 8);
    assert.equal(before.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(before.prepare('SELECT operation_id FROM execution_intents').get().operation_id, intent.operationId);
    assert.equal(before.prepare("SELECT 1 FROM sqlite_master WHERE name='runtime_leases'").get(), undefined);
  } finally { before.close(); }
});
