const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PassThrough } = require('node:stream');
require('ts-node').register({ transpileOnly: true });

async function fixture(t, terminals = [], beforeClose = async () => {}) {
  const boundary = require('../../src/main/runtime/codex/process.ts');
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const { ExecutionService } = require('../../src/main/services/execution.ts');
  const { associateProject } = require('../../src/main/storage/projects.ts');
  await fs.mkdir(path.resolve('.local-validation/m1-06'), { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-06/execution-exit-'));
  const project = associateProject(root, root).project;
  const input = new PassThrough(), output = new PassThrough(), calls = [];
  const emit = message => output.write(JSON.stringify(message) + '\n');
  let closed = 0;
  input.on('data', bytes => {
    const request = JSON.parse(bytes.toString()); calls.push(request);
    if (request.method === 'thread/start') emit({ id: request.id, result: {
      thread: { id: 'exit-thread', cwd: root }, cwd: root, model: 'deepseek-v4-flash', modelProvider: 'deepseek',
      approvalPolicy: 'on-request', approvalsReviewer: 'user', instructionSources: [],
      sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: false },
    } });
    else if (request.method === 'turn/start') emit({ id: request.id, result: { turn: { id: 'exit-turn' } } });
    else if (request.method === 'turn/interrupt') emit({ id: request.id, result: {} });
    else if (request.method === 'thread/backgroundTerminals/list') emit({ id: request.id, result: { data: terminals, nextCursor: null } });
    else assert.fail(`未预期的调用：${request.method}`);
  });
  t.mock.method(boundary, 'openExecutionCodex', async (_options, handlers) => {
    const transport = new CodexTransport(input, output, handlers);
    return { transport, close: async () => { await beforeClose(); closed++; transport.close(); input.destroy(); output.destroy(); } };
  });
  const service = new ExecutionService(root, root, { captureExecution: async () => ({
    modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID(), apiKey: 'synthetic-exit-key',
  }) });
  t.after(() => service.close());
  const request = { taskId: randomUUID(), operationId: randomUUID(), projectId: project.projectId,
    modelId: 'deepseek-v4-flash', configRevision: 1, text: '生命周期合成任务' };
  const task = await service.start(request);
  return { service, calls, emit, request, task, closed: () => closed };
}

test('停止后退出：中断应答后继续等待权威终态和后台核对，再回收本实例引擎', async t => {
  const f = await fixture(t);
  let finished = false;
  const exit = f.service.shutdown().then(() => { finished = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.service.read().task.executionState, 'stopping');
  assert.equal(f.closed(), 0);
  assert.equal(finished, false);
  assert.equal(f.calls.filter(value => value.method === 'turn/interrupt').length, 1);
  await assert.rejects(f.service.start({ ...f.request, taskId: randomUUID(), operationId: randomUUID() }), /退出/);
  f.emit({ method: 'turn/completed', params: { threadId: f.task.threadId, turn: { id: f.task.turnId, status: 'interrupted' } } });
  await exit;
  assert.equal(f.service.read().task.executionState, 'interrupted');
  assert.equal(f.closed(), 1);
  assert.equal(finished, true);
  assert.equal(f.calls.filter(value => value.method === 'turn/start').length, 1);
  assert.ok(f.calls.some(value => value.method === 'thread/backgroundTerminals/list'));
});

test('已有停止请求时退出共享同一次中断，等待进程关闭完成，不重复 interrupt', async t => {
  let allowClose, closeEntered;
  const closing = new Promise(resolve => { closeEntered = resolve; });
  const gate = new Promise(resolve => { allowClose = resolve; });
  const f = await fixture(t, [], async () => { closeEntered(); await gate; });
  t.after(() => allowClose());
  const stop = f.service.stop({ taskId: f.task.taskId, operationId: randomUUID(), threadId: f.task.threadId, turnId: f.task.turnId });
  const exit = f.service.shutdown();
  assert.equal(f.service.shutdown(), exit);
  let finished = false; const result = exit.then(() => { finished = true; });
  f.emit({ method: 'turn/completed', params: { threadId: f.task.threadId, turn: { id: f.task.turnId, status: 'interrupted' } } });
  await stop; await closing;
  assert.equal(finished, false);
  assert.equal(f.closed(), 0);
  assert.equal(f.calls.filter(value => value.method === 'turn/interrupt').length, 1);
  allowClose(); await result;
  assert.equal(f.closed(), 1);
});

test('引擎回收失败保留错误并禁止新任务，重试只回收而不重复发出轮次中断', async t => {
  let attempts = 0;
  const f = await fixture(t, [], async () => { if (++attempts === 1) throw new Error('合成引擎退出未确认'); });
  const exit = f.service.shutdown();
  const rejected = assert.rejects(exit, /引擎退出未确认/);
  await new Promise(resolve => setImmediate(resolve));
  f.emit({ method: 'turn/completed', params: { threadId: f.task.threadId, turn: { id: f.task.turnId, status: 'interrupted' } } });
  await rejected;
  assert.match(f.service.read().error, /引擎退出未确认/);
  assert.equal(f.closed(), 0);
  await assert.rejects(f.service.continue({ ...f.request, operationId: randomUUID(), threadId: f.task.threadId, expectedTurnId: f.task.turnId }), /核对/);
  await f.service.shutdown();
  assert.equal(f.closed(), 1);
  assert.equal(f.calls.filter(value => value.method === 'turn/interrupt').length, 1);
});

test('退出不能漏过归属未核实的后台终端：不终止陌生命令、不关闭引擎、不放行新任务', async t => {
  const f = await fixture(t, [{ itemId: 'unobserved-item', processId: 'unknown-process' }]);
  const exit = f.service.shutdown();
  const rejected = assert.rejects(exit, /后台.*归属|归属.*后台/);
  await new Promise(resolve => setImmediate(resolve));
  f.emit({ method: 'turn/completed', params: { threadId: f.task.threadId, turn: { id: f.task.turnId, status: 'interrupted' } } });
  await rejected;
  assert.equal(f.closed(), 0);
  assert.equal(f.calls.filter(value => value.method === 'thread/backgroundTerminals/terminate').length, 0);
  await assert.rejects(f.service.start({ ...f.request, taskId: randomUUID(), operationId: randomUUID() }), /核对/);
  assert.equal(f.service.needsExitConfirmation(), true);
});
