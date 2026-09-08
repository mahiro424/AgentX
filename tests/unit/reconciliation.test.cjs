const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
require('ts-node').register({ transpileOnly: true });

test('异常核对读取真实进程身份与精确公开历史，不重发、不解密 Key、不清除未决记录', async t => {
  const { ExecutionService } = require('../../src/main/services/execution.ts');
  const boundary = require('../../src/main/runtime/codex/process.ts');
  const { readProcessIdentity } = require('../../src/main/lifecycle/process-identity.ts');
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  const tasks = require('../../src/main/storage/tasks.ts');
  const leases = require('../../src/main/storage/runtime-leases.ts');
  await fs.mkdir(path.resolve('.local-validation/m1-06'), { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-06/reconcile-'));
  const project = associateProject(root, root).project, now = new Date().toISOString();
  const task = { taskId: randomUUID(), projectId: project.projectId, directory: root, title: '待核对任务',
    executionState: 'submitting', threadId: null, turnId: null, lastActivityAt: now, observedAt: now };
  const intent = { operationId: randomUUID(), text: '保留原始要求', modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID() };
  tasks.beginTaskSubmission(root, task, intent); tasks.markSubmissionDispatched(root, task.taskId, intent.operationId);
  tasks.bindSubmissionThread(root, task.taskId, intent.operationId, 'known-thread');
  tasks.acknowledgeSubmission(root, task.taskId, intent.operationId, 'known-thread', 'known-turn');
  tasks.markSubmissionUncertain(root, task.taskId, intent.operationId, new Date().toISOString());
  const child = spawn(process.execPath, ['-e', "process.stdin.resume();process.stdin.on('end',()=>process.exit(0))"],
    { windowsHide: true, shell: false, stdio: ['pipe', 'ignore', 'ignore'], env: { SystemRoot: process.env.SystemRoot } });
  const exited = once(child, 'exit'); t.after(async () => { child.stdin.end(); await exited; });
  const identity = await readProcessIdentity(child.pid);
  const lease = { leaseId: randomUUID(), instanceId: randomUUID(), taskId: task.taskId, operationId: intent.operationId,
    projectId: project.projectId, createdAt: now, identity };
  leases.acquireRuntimeLease(root, lease); leases.markRuntimeWorkStarted(root, lease.leaseId, lease.instanceId);
  const before = readWorkspace(root), beforeLeases = leases.readRuntimeLeases(root), calls = []; let closed = 0;
  t.mock.method(boundary, 'openCodex', async options => {
    assert.equal(options.environment.AGENTX_API_KEY, undefined);
    return { transport: { call: async (method, params) => {
      calls.push({ method, params });
      return { thread: { id: 'known-thread', cwd: root, turns: [{ id: 'known-turn', status: 'completed', error: null,
        itemsView: 'full', items: [{ id: 'answer', type: 'agentMessage', text: '已知历史内容', phase: 'final_answer' }] }] } };
    } }, close: async () => { closed++; } };
  });
  const service = new ExecutionService(root, root, { captureExecution: async () => assert.fail('核对不读取模型密钥') });
  t.after(() => service.close());
  const result = await service.readReconciliation({ taskId: task.taskId });
  assert.equal(result.taskId, task.taskId);
  assert.deepEqual(result.intents.map(value => [value.operationId, value.phase, value.turnId]), [[intent.operationId, 'unknown', 'known-turn']]);
  assert.equal(result.processes[0].state, 'sameProcess');
  assert.equal(result.processes[0].background, 'unverified');
  assert.equal(result.matchedTurnStatus, 'completed');
  assert.equal(result.history.turns[0].items[0].text, '已知历史内容');
  assert.equal(result.stale, false);
  assert.deepEqual(calls, [{ method: 'thread/read', params: { threadId: 'known-thread', includeTurns: true } }]);
  assert.equal(closed, 1);
  assert.deepEqual(readWorkspace(root), before);
  assert.deepEqual(leases.readRuntimeLeases(root), beforeLeases);
  assert.equal(tasks.readSubmissionIntent(root, intent.operationId).phase, 'unknown');
  assert.equal(JSON.stringify(result).includes(intent.credentialRef), false);
  await assert.rejects(service.start({ ...intent, taskId: randomUUID(), projectId: project.projectId }), /核对/);
});

test('PID 被复用、查询失败或根进程消失都不能推断后台已停；缺失意图绑定不认领最后一轮', async t => {
  const { ExecutionService } = require('../../src/main/services/execution.ts');
  const boundary = require('../../src/main/runtime/codex/process.ts');
  const identityBoundary = require('../../src/main/lifecycle/process-identity.ts');
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  const leases = require('../../src/main/storage/runtime-leases.ts');
  await fs.mkdir(path.resolve('.local-validation/m1-06'), { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-06/reconcile-unknown-'));
  const project = associateProject(root, root).project, now = new Date().toISOString(), taskId = randomUUID();
  require('../../src/main/storage/tasks.ts').createTaskRecord(root, { taskId, projectId: project.projectId, directory: root, title: '旧版未知任务',
    executionState: 'reconciling', threadId: 'legacy-thread', turnId: 'legacy-turn', lastActivityAt: now, observedAt: now });
  const identity = { pid: 1234, parentPid: process.pid, createdAt: now, executablePath: path.join(root, 'synthetic.exe') };
  const lease = { leaseId: randomUUID(), instanceId: randomUUID(), taskId, operationId: randomUUID(), projectId: project.projectId, createdAt: now, identity };
  leases.acquireRuntimeLease(root, lease); leases.markRuntimeWorkStarted(root, lease.leaseId, lease.instanceId);
  let processMode = 'pidReused', historyFailure = false;
  const calls = [];
  t.mock.method(identityBoundary, 'readProcessIdentity', async pid => {
    assert.equal(pid, identity.pid);
    if (processMode === 'unavailable') throw new Error('合成进程查询失败');
    return processMode === 'notFound' ? null : { ...identity, createdAt: '2020-01-01T00:00:00.000Z' };
  });
  t.mock.method(boundary, 'openCodex', async () => ({ transport: { call: async method => {
    calls.push(method);
    if (historyFailure) throw new Error('合成公开历史不可读');
    return { thread: { id: 'legacy-thread', cwd: root, turns: [{ id: 'legacy-turn', status: 'completed', items: [], itemsView: 'full', error: null }] } };
  } }, close: async () => {} }));
  const service = new ExecutionService(root, root, { captureExecution: async () => assert.fail('不得读取凭据') });
  t.after(() => service.close());
  const before = readWorkspace(root), ownership = leases.readRuntimeLeases(root);
  for (processMode of ['pidReused', 'unavailable', 'notFound']) {
    const value = await service.readReconciliation({ taskId });
    assert.equal(value.processes[0].state, processMode);
    assert.equal(value.processes[0].background, 'unverified');
    assert.equal(value.matchedTurnStatus, null);
    assert.match(value.bindingIssue, /缺少精确轮次/);
    if (processMode === 'unavailable') assert.match(value.processes[0].error, /合成进程查询失败/);
  }
  historyFailure = true;
  const failed = await service.readReconciliation({ taskId });
  assert.equal(failed.history, null); assert.match(failed.historyError, /合成公开历史不可读/);
  assert.equal(failed.processes[0].state, 'notFound');
  assert.deepEqual(readWorkspace(root), before); assert.deepEqual(leases.readRuntimeLeases(root), ownership);
  assert.deepEqual(calls, Array(4).fill('thread/read'));
});

test('准备记录没有会话关联时仅检查已保存归属，不启动历史连接；只接受任务 ID', async t => {
  const { ExecutionService } = require('../../src/main/services/execution.ts');
  const boundary = require('../../src/main/runtime/codex/process.ts');
  const { associateProject } = require('../../src/main/storage/projects.ts');
  const leases = require('../../src/main/storage/runtime-leases.ts');
  await fs.mkdir(path.resolve('.local-validation/m1-06'), { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-06/reconcile-prepared-'));
  const project = associateProject(root, root).project, taskId = randomUUID(), now = new Date().toISOString();
  leases.acquireRuntimeLease(root, { taskId, projectId: project.projectId, leaseId: randomUUID(), instanceId: randomUUID(), operationId: randomUUID(),
    createdAt: now, identity: { pid: 1234, parentPid: process.pid, createdAt: now, executablePath: path.join(root, 'synthetic.exe') } });
  t.mock.method(require('../../src/main/lifecycle/process-identity.ts'), 'readProcessIdentity', async () => null);
  t.mock.method(boundary, 'openCodex', async () => assert.fail('没有会话 ID，不允许猜测历史或创建引擎连接'));
  const service = new ExecutionService(root, root, { captureExecution: async () => assert.fail('不得读取凭据') });
  t.after(() => service.close());
  const value = await service.readReconciliation({ taskId });
  assert.match(value.historyError, /没有已确认的会话关联/);
  assert.deepEqual(value.intents, []); assert.equal(value.history, null);
  assert.deepEqual(service.read().reconciliationTaskIds, [taskId]);
  for (const invalid of [null, [], { taskId, method: 'turn/start' }, { taskId, path: root }, { taskId: 'not-an-id' }]) {
    await assert.rejects(service.readReconciliation(invalid), /请求无效/);
  }
  await assert.rejects(service.readReconciliation({ taskId: randomUUID() }), /不存在/);
  assert.equal(leases.readRuntimeLeases(root)[0].releasedAt, null);
});
