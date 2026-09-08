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
    return { transport, identity: { pid: 1234, parentPid: process.pid, createdAt: new Date().toISOString(), executablePath: path.join(root, 'synthetic-codex.exe') },
      close: async () => { transport.close(); input.destroy(); output.destroy(); } };
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
    return { transport, identity: { pid: 1234, parentPid: process.pid, createdAt: new Date().toISOString(), executablePath: path.join(root, 'synthetic-codex.exe') },
      close: async () => { transport.close(); input.destroy(); output.destroy(); } };
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


test('产品历史读取：只接受 taskId，从产品记录定位历史，无密钥也能读取已结束会话', async t => {
  const { ExecutionService } = require('../../src/main/services/execution.ts');
  const boundary = require('../../src/main/runtime/codex/process.ts');
  const { associateProject } = require('../../src/main/storage/projects.ts');
  const { createTaskRecord } = require('../../src/main/storage/tasks.ts');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-05/product-history-'));
  const project = associateProject(root, root).project;
  const taskId = randomUUID(), now = new Date().toISOString();
  createTaskRecord(root, { taskId, projectId: project.projectId, directory: root, title: '已结束任务',
    executionState: 'completed', threadId: 'history-thread', turnId: 'history-turn', lastActivityAt: now, observedAt: now });
  const calls = []; let closed = 0, reportedStatus = 'completed';
  t.mock.method(boundary, 'openCodex', async options => {
    assert.equal(options.environment.AGENTX_API_KEY, undefined);
    assert.equal(options.workingDirectory, root);
    return { transport: { call: async (method, params) => {
      calls.push({ method, params });
      return { thread: { id: 'history-thread', cwd: root, turns: [{ id: 'history-turn', status: reportedStatus, itemsView: 'full', items: [], error: null }] } };
    } }, close: async () => { closed++; } };
  });
  const service = new ExecutionService(root, root, { captureExecution: async () => assert.fail('历史不读取凭据') });
  t.after(() => service.close());
  const history = await service.readHistory({ taskId });
  assert.equal(history.taskId, taskId);
  assert.equal(history.threadId, 'history-thread');
  assert.equal(history.turns[0].turnId, 'history-turn');
  assert.equal(closed, 1);
  assert.deepEqual(calls, [{ method: 'thread/read', params: { threadId: 'history-thread', includeTurns: true } }]);
  assert.equal(service.read().task, null);
  await assert.rejects(service.readHistory({ taskId, threadId: 'foreign-thread' }), /无效/);
  await assert.rejects(service.readHistory({ taskId: randomUUID() }), /不存在/);
  assert.equal(calls.length, 1);
  reportedStatus = 'inProgress';
  await assert.rejects(service.readHistory({ taskId }), /历史.*状态.*不一致/);
});


test('搜索活动历史：只读本实例绑定轮次的公开历史，使用真实用户项 ID，不改变执行或发起第二轮', async t => {
  const { ExecutionService } = require('../../src/main/services/execution.ts');
  const boundary = require('../../src/main/runtime/codex/process.ts');
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  const { createTaskRecord } = require('../../src/main/storage/tasks.ts');
  await fs.mkdir(path.resolve('.local-validation/m2-01'), { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.local-validation/m2-01/live-search-history-'));
  const project = associateProject(root, root).project, calls = [];
  let handlers;
  t.mock.method(boundary, 'openExecutionCodex', async (options, events) => {
    handlers = events;
    return { identity: { pid: 1234, parentPid: process.pid, createdAt: new Date().toISOString(), executablePath: path.join(root, 'synthetic-codex.exe') },
      transport: { call: async method => {
        calls.push(method);
        if (method === 'thread/start') return { thread: { id: 'live-thread', cwd: root }, cwd: root, model: 'deepseek-v4-flash', modelProvider: 'deepseek', approvalPolicy: 'on-request', approvalsReviewer: 'user', instructionSources: [], sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: false } };
        if (method === 'turn/start') return { turn: { id: 'live-turn' } };
        if (method === 'thread/read') return { thread: { id: 'live-thread', cwd: root, turns: [{ id: 'live-turn', status: 'inProgress', itemsView: 'full', items: [{ id: 'actual-user-item', type: 'userMessage', content: [{ type: 'text', text: '当前轮中文搜索内容' }] }] }] } };
        assert.fail(`未预期的协议调用：${method}`);
      } }, close: async () => {} };
  });
  const service = new ExecutionService(root, root, { captureExecution: async () => ({ modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID(), apiKey: 'synthetic-live-search-key' }) });
  t.after(() => service.close());
  const task = await service.start({ taskId: randomUUID(), operationId: randomUUID(), projectId: project.projectId, modelId: 'deepseek-v4-flash', configRevision: 1, text: '当前轮中文搜索内容' });
  const before = readWorkspace(root);
  await assert.rejects(service.readHistory({ taskId: task.taskId }), /已结束/);
  const history = await service.readSearchHistory({ taskId: task.taskId });
  assert.equal(history.turns[0].items[0].itemId, 'actual-user-item');
  assert.equal(history.turns[0].status, 'inProgress');
  assert.deepEqual(readWorkspace(root), before);
  assert.deepEqual(calls, ['thread/start', 'turn/start', 'thread/read']);
  const foreignId = randomUUID();
  createTaskRecord(root, { ...task, taskId: foreignId, threadId: 'foreign-thread', turnId: 'foreign-turn' });
  await assert.rejects(service.readSearchHistory({ taskId: foreignId }), /未决|绑定|核对/);
  assert.equal(calls.length, 3);
  handlers.disconnected(new Error('合成断线'));
  await assert.rejects(service.readSearchHistory({ taskId: task.taskId }), /未决|绑定|核对/);
  assert.equal(calls.length, 3);
});

test('活动工具搜索：历史尚无输出时采用同一轮真实事件，命中定位不丢失用户项或重复命令', async t => {
  const { ExecutionService } = require('../../src/main/services/execution.ts');
  const { TaskSearchService } = require('../../src/main/services/task-search.ts');
  const boundary = require('../../src/main/runtime/codex/process.ts');
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  await fs.mkdir(path.resolve('.local-validation/m2-01'), { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.local-validation/m2-01/live-search-output-'));
  const project = associateProject(root, root).project, calls = [];
  const binding = { threadId: 'live-thread', turnId: 'live-turn' };
  const command = { id: 'actual-command', type: 'commandExecution', command: 'node probe.cjs', cwd: root,
    aggregatedOutput: null, status: 'inProgress', exitCode: null, durationMs: null };
  let handlers, includeCommand = false;
  t.mock.method(boundary, 'openExecutionCodex', async (options, events) => {
    handlers = events;
    return { identity: { pid: 1234, parentPid: process.pid, createdAt: new Date().toISOString(), executablePath: path.join(root, 'synthetic-codex.exe') },
      transport: { call: async method => {
        calls.push(method);
        if (method === 'thread/start') return { thread: { id: binding.threadId, cwd: root }, cwd: root, model: 'deepseek-v4-flash', modelProvider: 'deepseek', approvalPolicy: 'on-request', approvalsReviewer: 'user', instructionSources: [], sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: false } };
        if (method === 'turn/start') return { turn: { id: binding.turnId } };
        if (method === 'thread/read') return { thread: { id: binding.threadId, cwd: root, turns: [{ id: binding.turnId, status: 'inProgress', itemsView: 'full', items: [
          { id: 'actual-user', type: 'userMessage', content: [{ type: 'text', text: '执行探针' }] }, ...(includeCommand ? [command] : []),
        ] }] } };
        assert.fail(`搜索不得执行协议动作：${method}`);
      } }, close: async () => {} };
  });
  const service = new ExecutionService(root, root, { captureExecution: async () => ({ modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID(), apiKey: 'synthetic-search-key' }) });
  const search = new TaskSearchService(root, request => service.readSearchHistory(request));
  t.after(async () => { await search.pause(); await service.close(); });
  const task = await service.start({ taskId: randomUUID(), operationId: randomUUID(), projectId: project.projectId, modelId: 'deepseek-v4-flash', configRevision: 1, text: '执行探针' });
  handlers.notification({ method: 'item/started', params: { ...binding, item: command } });
  handlers.notification({ method: 'item/commandExecution/outputDelta', params: { ...binding, itemId: command.id, delta: '活动中文标记' } });
  const before = readWorkspace(root);
  assert.equal(service.read().items[0].output, '活动中文标记');
  for (const hasCommand of [false, true]) {
    includeCommand = hasCommand;
    await search.rebuild();
    const result = await search.query({ query: '活动中文标记', scope: 'body', projectId: null, includeArchived: false });
    assert.equal(result.results.length, 1, '实时已显示的输出必须可搜索，不能只依赖滞后的历史快照');
    const located = await search.locate({ taskId: task.taskId, ...result.results[0].source });
    assert.equal(located.source.itemId, command.id);
    assert.deepEqual(located.history.turns[0].items.map(item => item.itemId), ['actual-user', command.id]);
    assert.equal(located.history.turns[0].items[1].output, '活动中文标记');
    assert.equal(result.coverage.coveredTasks, 1);
  }
  assert.deepEqual(readWorkspace(root), before);
  assert.deepEqual(calls.slice(0, 2), ['thread/start', 'turn/start']);
  assert.ok(calls.slice(2).every(method => method === 'thread/read'));
});

test('首次发送基线：引擎收到 turn/start 前，原始文件已按同一操作持久化', async t => {
  const { ExecutionService } = require('../../src/main/services/execution.ts');
  const boundary = require('../../src/main/runtime/codex/process.ts');
  const { associateProject } = require('../../src/main/storage/projects.ts');
  const { readWorkspaceBaseline } = require('../../src/main/storage/results.ts');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-05/baseline-submit-'));
  const directory = path.join(root, 'project'); await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'main.txt'), '执行前人工内容');
  const project = associateProject(root, directory).project;
  const request = { taskId: randomUUID(), operationId: randomUUID(), projectId: project.projectId, modelId: 'deepseek-v4-flash', configRevision: 1, text: '合成修改要求' };
  const calls = [];
  t.mock.method(boundary, 'openExecutionCodex', async () => ({ identity: { pid: 1234, parentPid: process.pid, createdAt: new Date().toISOString(), executablePath: path.join(root, 'synthetic-codex.exe') }, transport: { call: async method => {
    calls.push(method);
    if (method === 'thread/start') return { thread: { id: 'baseline-thread', cwd: directory }, cwd: directory,
      model: 'deepseek-v4-flash', modelProvider: 'deepseek', approvalPolicy: 'on-request', approvalsReviewer: 'user',
      instructionSources: [], sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: false } };
    assert.equal(method, 'turn/start');
    const lease = require('../../src/main/storage/runtime-leases.ts').readRuntimeLeases(root)[0];
    assert.equal(lease.taskId, request.taskId);
    assert.equal(lease.operationId, request.operationId);
    assert.equal(lease.workStarted, true);
    const baseline = await readWorkspaceBaseline(root, request);
    assert.equal(baseline.snapshot.files.find(file => file.path === 'main.txt').text, '执行前人工内容');
    await fs.writeFile(path.join(directory, 'main.txt'), '执行后的合成内容');
    return { turn: { id: 'baseline-turn' } };
  } }, close: async () => {} }));
  const service = new ExecutionService(root, root, { captureExecution: async () => ({ modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID(), apiKey: 'synthetic-baseline-key' }) });
  t.after(() => service.close());
  await service.start(request);
  assert.deepEqual(calls, ['thread/start', 'turn/start']);
  const saved = await readWorkspaceBaseline(root, request);
  assert.equal(saved.snapshot.files.find(file => file.path === 'main.txt').text, '执行前人工内容');
  assert.doesNotMatch(JSON.stringify(saved), /synthetic-baseline-key/);
});

test('首次发送基线：保存失败不派发任务，回收引擎并保留可见错误', async t => {
  const { ExecutionService } = require('../../src/main/services/execution.ts');
  const boundary = require('../../src/main/runtime/codex/process.ts');
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-05/baseline-failure-'));
  const directory = path.join(root, 'project'); await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'main.txt'), '原有人工内容');
  await fs.writeFile(path.join(root, 'results'), '合成目录冲突，禁止覆盖');
  const project = associateProject(root, directory).project;
  let closed = 0, calls = 0;
  t.mock.method(boundary, 'openExecutionCodex', async () => ({ identity: { pid: 1234, parentPid: process.pid, createdAt: new Date().toISOString(), executablePath: path.join(root, 'synthetic-codex.exe') }, transport: { call: async () => {
    calls++; assert.fail('基线未保存，不允许派发任何任务 RPC');
  } }, close: async () => { closed++; } }));
  const service = new ExecutionService(root, root, { captureExecution: async () => ({ modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID(), apiKey: 'synthetic-baseline-key' }) });
  t.after(() => service.close());
  await assert.rejects(service.start({ taskId: randomUUID(), operationId: randomUUID(), projectId: project.projectId,
    modelId: 'deepseek-v4-flash', configRevision: 1, text: '不应发送的合成任务' }), /结果目录/);
  assert.equal(calls, 0);
  assert.equal(closed, 1);
  assert.equal(service.read().preparing, false);
  assert.match(service.read().error, /结果目录/);
  assert.deepEqual(readWorkspace(root).tasks, []);
  assert.equal(await fs.readFile(path.join(directory, 'main.txt'), 'utf8'), '原有人工内容');
  assert.equal(await fs.readFile(path.join(root, 'results'), 'utf8'), '合成目录冲突，禁止覆盖');
  const lease = require('../../src/main/storage/runtime-leases.ts').readRuntimeLeases(root)[0];
  assert.equal(lease.workStarted, false);
  assert.equal(typeof lease.releasedAt, 'string');
  assert.equal(service.needsExitConfirmation(), false);
});

test('引擎归属落盘失败：关闭刚启动的引擎，不派发任务且保留原数据库', async t => {
  const { ExecutionService } = require('../../src/main/services/execution.ts');
  const boundary = require('../../src/main/runtime/codex/process.ts');
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  const { DatabaseSync } = require('node:sqlite');
  await fs.mkdir(path.resolve('.local-validation/m1-06'), { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-06/lease-write-failure-'));
  const project = associateProject(root, root).project;
  const database = new DatabaseSync(path.join(root, 'agentx.db'));
  try { database.exec("CREATE TRIGGER reject_lease BEFORE INSERT ON runtime_leases BEGIN SELECT RAISE(ABORT,'synthetic-lease-write-error'); END"); }
  finally { database.close(); }
  let closed = 0;
  t.mock.method(boundary, 'openExecutionCodex', async () => ({
    identity: { pid: 1234, parentPid: process.pid, createdAt: new Date().toISOString(), executablePath: path.join(root, 'synthetic-codex.exe') },
    transport: { call: async () => assert.fail('归属未落盘，不得派发任务') }, close: async () => { closed++; },
  }));
  const service = new ExecutionService(root, root, { captureExecution: async () => ({ modelId: 'deepseek-v4-flash',
    configRevision: 1, credentialRef: randomUUID(), apiKey: 'synthetic-lease-key' }) });
  t.after(() => service.close());
  await assert.rejects(service.start({ taskId: randomUUID(), operationId: randomUUID(), projectId: project.projectId,
    modelId: 'deepseek-v4-flash', configRevision: 1, text: '不应发送' }), /元数据.*失败/);
  assert.equal(closed, 1);
  assert.deepEqual(readWorkspace(root), { projects: [project], tasks: [] });
  assert.match(service.read().error, /元数据.*失败/);
  assert.deepEqual(require('../../src/main/storage/runtime-leases.ts').readRuntimeLeases(root), []);
});

test('准备失败且首次回收未确认：尚无发送意图时允许重试回收退出，不误报存在任务', async t => {
  const { ExecutionService } = require('../../src/main/services/execution.ts');
  const boundary = require('../../src/main/runtime/codex/process.ts');
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  await fs.mkdir(path.resolve('.local-validation/m1-06'), { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-06/prepare-close-retry-'));
  const project = associateProject(root, root).project;
  await fs.writeFile(path.join(root, 'results'), '合成目录冲突');
  let closes = 0;
  t.mock.method(boundary, 'openExecutionCodex', async () => ({
    identity: { pid: 1234, parentPid: process.pid, createdAt: new Date().toISOString(), executablePath: path.join(root, 'synthetic-codex.exe') },
    transport: { call: async () => assert.fail('准备失败不得调用任务协议') },
    close: async () => { if (++closes === 1) throw new Error('首次回收未确认'); },
  }));
  const service = new ExecutionService(root, root, { captureExecution: async () => ({ modelId: 'deepseek-v4-flash',
    configRevision: 1, credentialRef: randomUUID(), apiKey: 'synthetic-retry-key' }) });
  t.after(() => service.close());
  await assert.rejects(service.start({ taskId: randomUUID(), operationId: randomUUID(), projectId: project.projectId,
    modelId: 'deepseek-v4-flash', configRevision: 1, text: '不应发送' }), /回收未确认/);
  assert.deepEqual(readWorkspace(root).tasks, []);
  assert.equal(service.needsExitConfirmation(), true);
  await service.shutdown();
  assert.equal(closes, 2);
  assert.equal(service.needsExitConfirmation(), false);
  assert.equal(typeof require('../../src/main/storage/runtime-leases.ts').readRuntimeLeases(root)[0].releasedAt, 'string');
});
