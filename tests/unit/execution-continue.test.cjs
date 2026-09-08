const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PassThrough } = require('node:stream');
require('ts-node').register({ transpileOnly: true });

async function fixture(t) {
  const processBoundary = require('../../src/main/runtime/codex/process.ts');
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const { ExecutionService } = require('../../src/main/services/execution.ts');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-05/continue-'));
  const directory = path.join(root, 'project'); await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'source.txt'), '原始人工内容\n');
  const project = require('../../src/main/storage/projects.ts').associateProject(root, directory).project;
  const sent = [], connections = [], turns = [], captures = [], controls = {};
  const metadata = () => ({ thread: { id: 'continue-thread', cwd: directory, status: { type: 'idle' } }, cwd: directory,
    model: 'deepseek-v4-flash', modelProvider: 'deepseek', approvalPolicy: 'on-request', approvalsReviewer: 'user',
    instructionSources: [], sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: false } });
  t.mock.method(processBoundary, 'openExecutionCodex', async (options, handlers) => {
    const input = new PassThrough(), output = new PassThrough();
    const emit = message => output.write(JSON.stringify(message) + '\n');
    const connection = { emit, handlers, options, closed: false }; connections.push(connection);
    input.on('data', bytes => {
      const request = JSON.parse(bytes.toString()); sent.push(request);
      if (request.method === 'thread/start' || request.method === 'thread/resume') emit({ id: request.id, result: { ...metadata(), ...(controls.metadata ?? {}) } });
      else if (request.method === 'thread/read') emit({ id: request.id, result: { thread: { id: 'continue-thread', cwd: directory, turns: controls.missingHistory ? [] : turns } } });
      else if (request.method === 'thread/backgroundTerminals/list') emit({ id: request.id, result: { data: controls.terminals ?? [], nextCursor: null } });
      else if (request.method === 'turn/start') {
        const turn = { id: `turn-${turns.length + 1}`, status: 'inProgress', items: [], itemsView: 'full' }; turns.push(turn);
        controls.beforeTurnReply?.({ request, turn, emit, transport });
        if (controls.loseReply) { transport.close(); return; }
        emit({ id: request.id, result: { turn } });
      } else assert.fail(`未预期的方法：${request.method}`);
    });
    const transport = new CodexTransport(input, output, handlers);
    return { transport, identity: { pid: 1234, parentPid: process.pid, createdAt: new Date().toISOString(), executablePath: path.join(root, 'synthetic-codex.exe') },
      close: async () => { connection.closed = true; transport.close(); input.destroy(); output.destroy(); } };
  });
  const service = new ExecutionService(root, root, { captureExecution: async revision => {
    if (controls.captureError) throw new Error(controls.captureError);
    captures.push(revision);
    return { modelId: 'deepseek-v4-flash', configRevision: revision, credentialRef: randomUUID(), apiKey: `synthetic-key-${revision}` };
  } });
  t.after(() => service.close());
  const firstRequest = { taskId: randomUUID(), operationId: randomUUID(), projectId: project.projectId,
    modelId: 'deepseek-v4-flash', configRevision: 1, text: '首次修复' };
  const first = await service.start(firstRequest);
  function complete(status = 'completed') {
    const turn = turns.at(-1); turn.status = status;
    connections.at(-1).emit({ method: 'turn/completed', params: { threadId: first.threadId, turn } });
  }
  const nextRequest = () => ({ ...firstRequest, operationId: randomUUID(), text: '继续完善', configRevision: 2,
    threadId: first.threadId, expectedTurnId: service.read().task.turnId });
  return { service, root, directory, sent, connections, turns, captures, controls, first, firstRequest, nextRequest, complete };
}

test('nextTurn：同任务恢复原 thread，以新配置发送独立轮次并保留原轮意图', async t => {
  const f = await fixture(t); f.complete();
  await fs.writeFile(path.join(f.directory, 'source.txt'), '第一轮后的内容\n');
  const request = f.nextRequest();
  const second = await f.service.continue(request);
  assert.equal(second.taskId, f.first.taskId); assert.equal(second.threadId, f.first.threadId);
  assert.equal(second.turnId, 'turn-2'); assert.equal(second.executionState, 'running');
  assert.equal(second.title, f.first.title);
  assert.deepEqual(f.captures, [1, 2]);
  assert.equal(f.connections[0].closed, true);
  const leases = require('../../src/main/storage/runtime-leases.ts').readRuntimeLeases(f.root);
  assert.equal(leases.length, 2);
  assert.equal(typeof leases.find(lease => lease.operationId === f.firstRequest.operationId).releasedAt, 'string');
  assert.equal(leases.find(lease => lease.operationId === request.operationId).releasedAt, null);
  assert.equal(f.connections[1].options.environment.AGENTX_API_KEY, 'synthetic-key-2');
  assert.equal(f.sent.filter(request => request.method === 'thread/start').length, 1);
  assert.equal(f.sent.filter(request => request.method === 'thread/resume').length, 1);
  assert.deepEqual(f.sent.filter(request => request.method === 'turn/start').map(request => request.params.threadId), [f.first.threadId, f.first.threadId]);
  const store = require('../../src/main/storage/tasks.ts');
  assert.equal(store.readSubmissionIntent(f.root, f.firstRequest.operationId).phase, 'settled');
  assert.equal(store.readSubmissionIntent(f.root, f.firstRequest.operationId).text, '首次修复');
  assert.equal(store.readSubmissionIntent(f.root, request.operationId).configRevision, 2);
  assert.equal(store.readTurnOperation(f.root, second.taskId, 'turn-1'), f.firstRequest.operationId);
  assert.equal(store.readTurnOperation(f.root, second.taskId, 'turn-2'), request.operationId);
  f.complete();
  const result = await require('../../src/main/services/task-results.ts').readTaskResults(f.root, { taskId: second.taskId, turnId: second.turnId });
  assert.deepEqual(result.changes, []);
});

test('nextTurn：新轮应答前晚到的旧轮命令输出与终态不能破坏新轮关联', async t => {
  const f = await fixture(t); f.complete();
  f.controls.beforeTurnReply = ({ emit }) => {
    emit({ method: 'item/commandExecution/outputDelta', params: { threadId: f.first.threadId, turnId: f.first.turnId, itemId: 'old-command', delta: '旧输出' } });
    emit({ method: 'turn/completed', params: { threadId: f.first.threadId, turn: { id: f.first.turnId, status: 'completed' } } });
  };
  const second = await f.service.continue(f.nextRequest());
  assert.equal(second.turnId, 'turn-2'); assert.equal(second.executionState, 'running');
  assert.deepEqual(f.service.read().items, []);
  f.connections[0].handlers.disconnected(new Error('旧连接迟到的断线'));
  assert.equal(f.service.read().task.executionState, 'running');
  f.complete();
});

test('nextTurn：应答丢失进入核对，重开协调器也不自动或显式重复发送未决任务', async t => {
  const f = await fixture(t); f.complete(); f.controls.loseReply = true;
  const request = f.nextRequest();
  await assert.rejects(f.service.continue(request), /关闭|核对/);
  const store = require('../../src/main/storage/tasks.ts');
  assert.equal(store.readSubmissionIntent(f.root, request.operationId).phase, 'unknown');
  assert.equal(f.service.read().task.executionState, 'reconciling');
  assert.equal(store.readSubmissionIntent(f.root, f.firstRequest.operationId).phase, 'settled');
  await assert.rejects(f.service.continue(request), /未确认|变化|核对/);
  const { ExecutionService } = require('../../src/main/services/execution.ts');
  const reopened = new ExecutionService(f.root, f.root, { captureExecution: async () => assert.fail('未决任务不应读取新凭据') });
  t.after(() => reopened.close());
  await assert.rejects(reopened.continue(request), /未确认|变化|核对/);
  assert.equal(f.sent.filter(request => request.method === 'turn/start').length, 2);
});

test('nextTurn：当前轮过时、复用操作或非 Flash 请求在派发前拒绝', async t => {
  const f = await fixture(t); f.complete();
  for (const change of [{ expectedTurnId: 'obsolete' }, { threadId: 'other' }, { operationId: f.firstRequest.operationId }, { modelId: 'other-model' }, { cwd: f.root }]) {
    await assert.rejects(f.service.continue({ ...f.nextRequest(), ...change }));
  }
  assert.deepEqual(f.captures, [1]);
  assert.equal(f.connections.length, 1); assert.equal(f.service.read().task.executionState, 'completed');
});

test('nextTurn：新配置、历史或恢复元数据不符时保留旧轮终态，不降级旧凭据或另建 thread', async t => {
  const f = await fixture(t); f.complete();
  const store = require('../../src/main/storage/tasks.ts');
  f.controls.captureError = '新配置不可用';
  let request = f.nextRequest();
  await assert.rejects(f.service.continue(request), /新配置不可用/);
  assert.equal(store.readSubmissionIntent(f.root, request.operationId), null);
  f.controls.captureError = null; f.controls.missingHistory = true;
  request = f.nextRequest(); await assert.rejects(f.service.continue(request), /历史.*不一致/);
  assert.equal(store.readSubmissionIntent(f.root, request.operationId), null);
  f.controls.missingHistory = false;
  for (const metadata of [{ model: 'other-model' }, { approvalPolicy: 'never' }, { sandbox: { type: 'dangerFullAccess' } },
    { thread: { id: f.first.threadId, cwd: f.directory, status: { type: 'active', activeFlags: [] } } }]) {
    f.controls.metadata = metadata; request = f.nextRequest(); await assert.rejects(f.service.continue(request));
    assert.equal(store.readSubmissionIntent(f.root, request.operationId), null);
    assert.equal(f.service.read().task.executionState, 'completed');
  }
  assert.equal(f.sent.filter(request => request.method === 'turn/start').length, 1);
  assert.equal(f.sent.filter(request => request.method === 'thread/start').length, 1);
});

test('nextTurn：新轮完成先于应答仍只结束新轮；旧审批不能被回答', async t => {
  const f = await fixture(t); f.complete('interrupted');
  f.controls.beforeTurnReply = ({ emit, turn }) => {
    emit({ id: 'stale-approval', method: 'item/fileChange/requestApproval', params: { threadId: f.first.threadId,
      turnId: f.first.turnId, itemId: 'stale-file', startedAtMs: 1 } });
    turn.status = 'completed'; emit({ method: 'turn/completed', params: { threadId: f.first.threadId, turn } });
  };
  const request = f.nextRequest(), second = await f.service.continue(request);
  assert.equal(second.executionState, 'completed'); assert.equal(second.turnId, 'turn-2');
  assert.deepEqual(f.service.read().approvals, []);
  assert.equal(require('../../src/main/storage/tasks.ts').readSubmissionIntent(f.root, request.operationId).phase, 'settled');
  assert.equal(f.sent.filter(request => 'result' in request).length, 0);
});

test('nextTurn：事务拒绝重复意图后，原轮与任务关联不发生半写入', async t => {
  const f = await fixture(t); f.complete();
  const store = require('../../src/main/storage/tasks.ts');
  const previous = f.service.read().task;
  assert.throws(() => store.beginTaskContinuation(f.root, previous, { ...store.readSubmissionIntent(f.root, f.firstRequest.operationId), text: '不应覆盖旧输入' }));
  assert.deepEqual(f.service.read().task, previous);
  assert.equal(store.readSubmissionIntent(f.root, f.firstRequest.operationId).text, '首次修复');
});

test('nextTurn：旧轮后台归属不明时保留原连接和归属记录，不启动替换引擎', async t => {
  const f = await fixture(t); f.complete();
  f.controls.terminals = [{ itemId: 'unobserved-command', processId: 'unknown-background' }];
  const leases = require('../../src/main/storage/runtime-leases.ts');
  const before = leases.readRuntimeLeases(f.root);
  await assert.rejects(f.service.continue(f.nextRequest()), /后台.*归属|归属.*后台/);
  assert.deepEqual(leases.readRuntimeLeases(f.root), before);
  assert.equal(f.connections.length, 1);
  assert.equal(f.connections[0].closed, false);
  assert.equal(f.sent.filter(request => request.method === 'turn/start').length, 1);
  assert.equal(f.sent.filter(request => request.method === 'thread/backgroundTerminals/terminate').length, 0);
});
