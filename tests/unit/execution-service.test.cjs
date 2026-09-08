const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PassThrough } = require('node:stream');
require('ts-node').register({ transpileOnly: true });

test('执行产品控制：首次提交、补充、审批、停止经过同一真实协调与存储链路', async t => {
  const processBoundary = require('../../src/main/runtime/codex/process.ts');
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const { ExecutionService } = require('../../src/main/services/execution.ts');
  const { ProjectService } = require('../../src/main/services/projects.ts');
  const { associateProject } = require('../../src/main/storage/projects.ts');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-04/service-control-'));
  const project = associateProject(root, root).project;
  const input = new PassThrough(), output = new PassThrough(), sent = [];
  const emit = value => output.write(JSON.stringify(value) + '\n');
  input.on('data', bytes => {
    const request = JSON.parse(bytes.toString()); sent.push(request);
    if ('result' in request) { emit({ method: 'serverRequest/resolved', params: { threadId: 'thread-control', requestId: request.id } }); return; }
    if (request.method === 'thread/start') emit({ id: request.id, result: {
      thread: { id: 'thread-control', cwd: root }, cwd: root, model: 'deepseek-v4-flash', modelProvider: 'deepseek',
      approvalPolicy: 'on-request', approvalsReviewer: 'user', instructionSources: [],
      sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: false },
    } });
    else if (request.method === 'turn/start') {
      emit({ id: 'approval-original', method: 'item/fileChange/requestApproval', params: {
        threadId: 'thread-control', turnId: 'turn-control', itemId: 'file-control', startedAtMs: 1,
      } });
      emit({ id: request.id, result: { turn: { id: 'turn-control' } } });
    } else if (request.method === 'turn/steer') emit({ id: request.id, result: { turnId: 'turn-control' } });
    else if (request.method === 'turn/interrupt') emit({ id: request.id, result: {} });
    else if (request.method === 'thread/backgroundTerminals/list') emit({ id: request.id, result: { data: [], nextCursor: null } });
    else assert.fail('未预期的协议调用');
  });
  t.mock.method(processBoundary, 'openExecutionCodex', async (options, handlers) => {
    assert.equal(options.workingDirectory, root);
    assert.equal(options.environment.AGENTX_API_KEY, 'synthetic-control-key');
    const transport = new CodexTransport(input, output, handlers);
    return { transport, close: async () => { transport.close(); input.destroy(); output.destroy(); } };
  });
  let updates = 0;
  const service = new ExecutionService(root, root, { captureExecution: async () => ({
    modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID(), apiKey: 'synthetic-control-key',
  }) }, () => { updates++; });
  t.after(() => service.close());
  const projects = new ProjectService(root, () => service.read().task);
  const task = await service.start({ taskId: randomUUID(), operationId: randomUUID(), projectId: project.projectId,
    modelId: 'deepseek-v4-flash', configRevision: 1, text: '合成输入' });
  assert.equal(task.executionState, 'waitingApproval');
  assert.equal(service.read().inputText, '合成输入');
  assert.equal((await projects.read()).tasks[0].executionState, 'waitingApproval');
  const control = () => ({ taskId: task.taskId, operationId: randomUUID(), threadId: task.threadId, turnId: task.turnId });
  const steer = { ...control(), text: '保留人工修改' };
  await service.steer(steer);
  await assert.rejects(service.steer(steer), /已使用/);
  const approval = service.read().approvals[0];
  await assert.rejects(service.answer({ ...control(), approvalToken: approval.approvalToken, decision: 'acceptForSession' }), /本次|无效/);
  await service.answer({ ...control(), approvalToken: approval.approvalToken, decision: 'accept' });
  assert.equal(service.read().task.executionState, 'running');
  assert.equal((await projects.read()).tasks[0].executionState, 'running');
  assert.deepEqual(sent.find(value => value.id === 'approval-original'), { id: 'approval-original', result: { decision: 'accept' } });
  const stopping = service.stop(control());
  assert.equal(service.read().task.executionState, 'stopping');
  assert.equal((await projects.read()).tasks[0].executionState, 'stopping');
  emit({ method: 'turn/completed', params: { threadId: task.threadId, turn: { id: task.turnId, status: 'interrupted' } } });
  assert.equal(service.read().task.executionState, 'stopping');
  await stopping;
  assert.equal(service.read().task.executionState, 'interrupted');
  assert.equal(service.read().inputText, '合成输入');
  assert.equal((await projects.read()).tasks[0].executionState, 'interrupted');
  assert.equal(sent.filter(value => value.method === 'turn/start').length, 1);
  assert.equal(sent.filter(value => value.method === 'turn/steer').length, 1);
  assert.equal(JSON.stringify(service.read()).includes('synthetic-control-key'), false);
  assert.ok(updates > 0);
});

test('停止清理失败：轮次中断也不冒充全部停止，保留核对状态且禁止重发', async t => {
  const processBoundary = require('../../src/main/runtime/codex/process.ts');
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const { ExecutionService } = require('../../src/main/services/execution.ts');
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-04/stop-cleanup-failure-'));
  const project = associateProject(root, root).project;
  const input = new PassThrough(), output = new PassThrough(), sent = [];
  const emit = value => output.write(JSON.stringify(value) + '\n');
  input.on('data', bytes => {
    const request = JSON.parse(bytes.toString()); sent.push(request);
    if (request.method === 'thread/start') emit({ id: request.id, result: {
      thread: { id: 'thread-cleanup', cwd: root }, cwd: root, model: 'deepseek-v4-flash', modelProvider: 'deepseek',
      approvalPolicy: 'on-request', approvalsReviewer: 'user', instructionSources: [],
      sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: false },
    } });
    else if (request.method === 'turn/start') emit({ id: request.id, result: { turn: { id: 'turn-cleanup' } } });
    else if (request.method === 'turn/interrupt') emit({ id: request.id, result: {} });
    else if (request.method === 'thread/backgroundTerminals/list') emit({ id: request.id, result: {
      data: [{ itemId: 'command-owned', processId: 'process-owned' }, { itemId: 'command-foreign', processId: 'process-foreign' }], nextCursor: null,
    } });
    // 终止应答成功，但随后列表仍报告进程存在：不能据应答清空活动状态。
    else if (request.method === 'thread/backgroundTerminals/terminate') emit({ id: request.id, result: { terminated: true } });
    else assert.fail('未预期的协议调用');
  });
  t.mock.method(processBoundary, 'openExecutionCodex', async (_options, handlers) => {
    const transport = new CodexTransport(input, output, handlers);
    return { transport, close: async () => { transport.close(); input.destroy(); output.destroy(); } };
  });
  const service = new ExecutionService(root, root, { captureExecution: async () => ({
    modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID(), apiKey: 'synthetic-cleanup-key',
  }) });
  t.after(() => service.close());
  const request = { taskId: randomUUID(), operationId: randomUUID(), projectId: project.projectId,
    modelId: 'deepseek-v4-flash', configRevision: 1, text: '清理失败合成场景' };
  const task = await service.start(request);
  const control = () => ({ taskId: task.taskId, operationId: randomUUID(), threadId: task.threadId, turnId: task.turnId });
  emit({ method: 'item/started', params: { threadId: task.threadId, turnId: task.turnId, item: {
    type: 'commandExecution', id: 'command-owned', command: 'node delayed.cjs', cwd: root,
    status: 'inProgress', aggregatedOutput: null, exitCode: null, durationMs: null,
  } } });
  const stopping = service.stop(control());
  const rejected = assert.rejects(stopping, /后台命令仍在运行/);
  emit({ method: 'turn/completed', params: { threadId: task.threadId, turn: { id: task.turnId, status: 'interrupted' } } });
  assert.equal(service.read().task.executionState, 'stopping');
  await rejected;
  assert.equal(service.read().task.executionState, 'reconciling');
  assert.equal(readWorkspace(root).tasks[0].executionState, 'reconciling');
  assert.equal(service.read().inputText, request.text);
  await assert.rejects(service.stop(control()), /失效|有效|当前/);
  await assert.rejects(service.start({ ...request, taskId: randomUUID(), operationId: randomUUID() }), /活动|核对/);
  assert.equal(sent.filter(value => value.method === 'turn/start').length, 1);
  assert.equal(sent.filter(value => value.method === 'turn/interrupt').length, 1);
  assert.deepEqual(sent.filter(value => value.method === 'thread/backgroundTerminals/terminate').map(value => value.params),
    [{ threadId: task.threadId, processId: 'process-owned' }]);
});

test('执行入口：配置准备期间拒绝另一任务，模型阻断不创建任务或启动引擎', async () => {
  const { ExecutionService } = require('../../src/main/services/execution.ts');
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-04/execution-service-'));
  const project = associateProject(root, root).project;
  let rejectCapture, enteredCapture;
  const entered = new Promise(resolve => { enteredCapture = resolve; });
  let captures = 0;
  const models = { captureExecution: async revision => {
    captures++; assert.equal(revision, 1); enteredCapture();
    return new Promise((_, reject) => { rejectCapture = reject; });
  } };
  const service = new ExecutionService(root, path.join(root, 'missing-resources'), models);
  assert.deepEqual(service.read(), { preparing: false, task: null, operationId: null, items: [], approvals: [], error: null });
  const request = { taskId: randomUUID(), operationId: randomUUID(), projectId: project.projectId,
    text: '修复合成项目', modelId: 'deepseek-v4-flash', configRevision: 1 };
  await assert.rejects(service.start({ ...request, modelId: 'other-model' }), /Flash/);
  assert.equal(captures, 0);
  const first = service.start(request);
  const failed = assert.rejects(first, /请先保存密钥/);
  await entered;
  assert.equal(service.read().preparing, true);
  await assert.rejects(service.start({ ...request, taskId: randomUUID(), operationId: randomUUID() }), /活动|准备/);
  assert.equal(captures, 1);
  rejectCapture(new Error('请先保存密钥')); await failed;
  assert.equal(service.read().preparing, false);
  assert.equal(service.read().error, '请先保存密钥');
  await assert.rejects(service.stop({ taskId: request.taskId, operationId: randomUUID(), threadId: 'foreign', turnId: 'foreign' }), /有效|当前/);
  assert.deepEqual(readWorkspace(root).tasks, []);
  await assert.rejects(fs.stat(path.join(root, 'engine')), { code: 'ENOENT' });
  await service.close();
  await assert.rejects(service.start(request), /退出/);
});

test('执行入口：固定资源缺失不发送任务，保留明确失败且允许修复后重新准备', async () => {
  const { ExecutionService } = require('../../src/main/services/execution.ts');
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-04/execution-resources-'));
  const project = associateProject(root, root).project;
  let captures = 0;
  const service = new ExecutionService(root, path.join(root, 'missing-resources'), {
    captureExecution: async () => {
      captures++;
      return { modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID(), apiKey: 'synthetic-no-network-key' };
    },
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(service.start({ taskId: randomUUID(), operationId: randomUUID(), projectId: project.projectId,
      text: '不会真正执行的合成请求', modelId: 'deepseek-v4-flash', configRevision: 1 }), /ENOENT/);
    assert.deepEqual(readWorkspace(root).tasks, []);
  }
  assert.equal(captures, 2);
  const engineFiles = await fs.readdir(path.join(root, 'engine', 'codex'));
  assert.deepEqual(engineFiles, ['models.json']);
  assert.equal((await fs.readFile(path.join(root, 'engine', 'codex', 'models.json'), 'utf8')).includes('synthetic-no-network-key'), false);
});
