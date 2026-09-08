const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PassThrough } = require('node:stream');
require('ts-node').register({ transpileOnly: true });

test('停止控制：同一连接中断已绑定轮次，应答不等于停止，终态后才结束', async () => {
  const { FirstTurnSession } = require('../../src/main/services/execution.ts');
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-04/session-stop-'));
  const project = associateProject(root, root).project, time = new Date().toISOString();
  const task = { taskId: randomUUID(), projectId: project.projectId, directory: root, title: '停止控制',
    lastActivityAt: time, observedAt: time, executionState: 'submitting', threadId: null, turnId: null };
  const intent = { operationId: randomUUID(), text: '合成任务', modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID() };
  const session = new FirstTurnSession(root, task, intent);
  const input = new PassThrough(), output = new PassThrough(), sent = [];
  let pendingSteerId;
  input.on('data', bytes => {
    const request = JSON.parse(bytes.toString()); sent.push(request);
    let result;
    if (request.method === 'thread/start') result = {
      thread: { id: 'thread-stop', cwd: root }, cwd: root, model: 'deepseek-v4-flash', modelProvider: 'deepseek',
      approvalPolicy: 'on-request', approvalsReviewer: 'user', instructionSources: [],
      sandbox: { type: 'workspaceWrite', networkAccess: false, writableRoots: [] },
    };
    else if (request.method === 'turn/start') result = { turn: { id: 'turn-stop', status: 'inProgress' } };
    else if (request.method === 'thread/backgroundTerminals/list') result = { data: [], nextCursor: null };
    else if (request.method === 'turn/steer') {
      if (request.params.input[0].text === '待答补充') { pendingSteerId = request.id; return; }
      assert.equal(request.params.expectedTurnId, 'turn-stop'); result = { turnId: 'turn-stop' };
    }
    else {
      assert.equal(readWorkspace(root).tasks[0].executionState, 'stopping');
      assert.equal(request.method, 'turn/interrupt'); assert.deepEqual(request.params, { threadId: 'thread-stop', turnId: 'turn-stop' }); result = {};
    }
    output.write(JSON.stringify({ id: request.id, result }) + '\n');
  });
  const transport = new CodexTransport(input, output, { notification: message => session.notification(message), request() {}, disconnected: () => session.disconnected() });
  try {
    await assert.rejects(session.stop(), /尚无有效轮次/);
    await session.submit(transport);
    assert.deepEqual(await session.steer('继续保留原有修改'), { turnId: 'turn-stop' });
    assert.equal(readWorkspace(root).tasks[0].executionState, 'running');
    const pendingSteer = session.steer('待答补充');
    await assert.rejects(session.steer('重复点击'), /补充请求尚不可用/);
    const stopping = session.stop();
    output.write(JSON.stringify({ id: pendingSteerId, result: { turnId: 'turn-stop' } }) + '\n');
    await pendingSteer;
    assert.equal(readWorkspace(root).tasks[0].executionState, 'stopping');
    await assert.rejects(session.steer('停止中不得补充'), /当前轮次不接受补充/);
    await assert.rejects(session.stop());
    output.write(JSON.stringify({ method: 'turn/completed', params: { threadId: 'thread-stop', turn: { id: 'turn-stop', status: 'interrupted' } } }) + '\n');
    assert.equal(readWorkspace(root).tasks[0].executionState, 'stopping');
    await stopping;
    assert.equal(readWorkspace(root).tasks[0].executionState, 'interrupted');
    await assert.rejects(session.stop());
    assert.equal(sent.filter(request => request.method === 'turn/interrupt').length, 1);
  } finally { transport.close(); input.destroy(); output.destroy(); }
});

test('早到终态保存失败：保留轮次关联并进入核对，不继续显示运行或重发', async () => {
  const { FirstTurnSession } = require('../../src/main/services/execution.ts');
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  const { readSubmissionIntent } = require('../../src/main/storage/tasks.ts');
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const { DatabaseSync } = require('node:sqlite');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-04/session-save-failure-'));
  const project = associateProject(root, root).project, time = new Date().toISOString();
  const database = new DatabaseSync(path.join(root, 'agentx.db'));
  try { database.exec("CREATE TRIGGER refuse_terminal BEFORE UPDATE ON tasks WHEN NEW.execution_state='completed' BEGIN SELECT RAISE(FAIL, 'synthetic-terminal-write-failure'); END"); }
  finally { database.close(); }
  const task = { taskId: randomUUID(), projectId: project.projectId, directory: root, title: '落盘故障',
    lastActivityAt: time, observedAt: time, executionState: 'submitting', threadId: null, turnId: null };
  const intent = { operationId: randomUUID(), text: '合成任务', modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID() };
  const session = new FirstTurnSession(root, task, intent);
  const input = new PassThrough(), output = new PassThrough();
  input.on('data', bytes => {
    const request = JSON.parse(bytes.toString());
    if (request.method === 'thread/start') output.write(JSON.stringify({ id: request.id, result: {
      thread: { id: 'thread-save', cwd: root }, cwd: root, model: 'deepseek-v4-flash', modelProvider: 'deepseek',
      approvalPolicy: 'on-request', approvalsReviewer: 'user', instructionSources: [],
      sandbox: { type: 'workspaceWrite', networkAccess: false, writableRoots: [] },
    } }) + '\n');
    else {
      output.write(JSON.stringify({ method: 'turn/completed', params: { threadId: 'thread-save', turn: { id: 'turn-save', status: 'completed' } } }) + '\n');
      output.write(JSON.stringify({ id: request.id, result: { turn: { id: 'turn-save', status: 'inProgress' } } }) + '\n');
    }
  });
  const transport = new CodexTransport(input, output, { notification: message => session.notification(message), request() {}, disconnected: () => session.disconnected() });
  try {
    await assert.rejects(session.submit(transport), /产品元数据/);
    const stored = readWorkspace(root).tasks[0];
    assert.equal(stored.executionState, 'reconciling'); assert.equal(stored.turnId, 'turn-save');
    assert.equal(readSubmissionIntent(root, intent.operationId).phase, 'unknown');
    await assert.rejects(session.submit(transport), /不可重复/);
  } finally { transport.close(); input.destroy(); output.destroy(); }
});

test('首次会话观测：停止应答丢失保留关联，旧回调不能解除未决状态', async () => {
  const { FirstTurnSession } = require('../../src/main/services/execution.ts');
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  const { readSubmissionIntent } = require('../../src/main/storage/tasks.ts');
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-04/session-lost-'));
  const project = associateProject(root, root).project, time = new Date().toISOString();
  const task = { taskId: randomUUID(), projectId: project.projectId, directory: root, title: '运行后断线',
    lastActivityAt: time, observedAt: time, executionState: 'submitting', threadId: null, turnId: null };
  const intent = { operationId: randomUUID(), text: '合成任务', modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID() };
  const session = new FirstTurnSession(root, task, intent);
  const input = new PassThrough(), output = new PassThrough();
  input.on('data', bytes => {
    const request = JSON.parse(bytes.toString());
    if (request.method === 'turn/interrupt') { output.end(); return; }
    const result = request.method === 'thread/start' ? {
      thread: { id: 'thread-lost', cwd: root }, cwd: root, model: 'deepseek-v4-flash', modelProvider: 'deepseek',
      approvalPolicy: 'on-request', approvalsReviewer: 'user', instructionSources: [],
      sandbox: { type: 'workspaceWrite', networkAccess: false, writableRoots: [] },
    } : { turn: { id: 'turn-lost', status: 'inProgress' } };
    output.write(JSON.stringify({ id: request.id, result }) + '\n');
  });
  const transport = new CodexTransport(input, output, { notification: message => session.notification(message), request() {}, disconnected: () => session.disconnected() });
  try {
    await session.submit(transport);
    await assert.rejects(session.stop(), /断开/);
    session.disconnected();
    assert.equal(readSubmissionIntent(root, intent.operationId).phase, 'unknown');
    session.notification({ method: 'turn/completed', params: { threadId: 'thread-lost', turn: { id: 'turn-lost', status: 'completed' } } });
    const stored = readWorkspace(root).tasks[0];
    assert.equal(stored.executionState, 'reconciling'); assert.equal(stored.turnId, 'turn-lost');
    await assert.rejects(session.submit(transport), /不可重复/);
  } finally { transport.close(); input.destroy(); output.destroy(); }
});

test('首次会话观测：早到完成通知等待关联落盘，失效连接不再修改任务', async () => {
  const { FirstTurnSession } = require('../../src/main/services/execution.ts');
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-04/session-early-'));
  const project = associateProject(root, root).project, time = new Date().toISOString();
  const task = { taskId: randomUUID(), projectId: project.projectId, directory: root, title: '早到事件',
    lastActivityAt: time, observedAt: time, executionState: 'submitting', threadId: null, turnId: null };
  const intent = { operationId: randomUUID(), text: '合成任务', modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID() };
  const session = new FirstTurnSession(root, task, intent);
  const input = new PassThrough(), output = new PassThrough();
  const completed = { method: 'turn/completed', params: { threadId: 'thread-early', turn: { id: 'turn-early', status: 'completed' } } };
  input.on('data', bytes => {
    const request = JSON.parse(bytes.toString());
    if (request.method === 'thread/start') output.write(JSON.stringify({ id: request.id, result: {
      thread: { id: 'thread-early', cwd: root }, cwd: root, model: 'deepseek-v4-flash', modelProvider: 'deepseek',
      approvalPolicy: 'on-request', approvalsReviewer: 'user', instructionSources: [],
      sandbox: { type: 'workspaceWrite', networkAccess: false, writableRoots: [] },
    } }) + '\n');
    else {
      output.write(JSON.stringify(completed) + '\n');
      assert.equal(readWorkspace(root).tasks[0].executionState, 'submitting');
      output.write(JSON.stringify({ id: request.id, result: { turn: { id: 'turn-early', status: 'inProgress' } } }) + '\n');
    }
  });
  const transport = new CodexTransport(input, output, { notification: message => session.notification(message), request() {}, disconnected: () => session.disconnected() });
  try {
    await session.submit(transport);
    assert.equal(readWorkspace(root).tasks[0].executionState, 'completed');
    session.disconnected();
    session.notification({ ...completed, params: { ...completed.params, turn: { id: 'turn-early', status: 'failed' } } });
    assert.equal(readWorkspace(root).tasks[0].executionState, 'completed');
    await assert.rejects(session.submit(transport), /不可重复/);
  } finally { transport.close(); input.destroy(); output.destroy(); }
});

test('首次提交协调：请求前已落盘，thread 关联先于输入，轮次应答关联到原任务', async () => {
  const { submitFirstTurn, observeTurnCompletion } = require('../../src/main/services/execution.ts');
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  const { readSubmissionIntent } = require('../../src/main/storage/tasks.ts');
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-04/coordinator-'));
  const project = associateProject(root, root).project, time = new Date().toISOString();
  const task = { taskId: randomUUID(), projectId: project.projectId, directory: root, title: '修复项目',
    lastActivityAt: time, observedAt: time, executionState: 'submitting', threadId: null, turnId: null };
  const intent = { operationId: randomUUID(), text: '修复两个文件', modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID() };
  const input = new PassThrough(), output = new PassThrough(), sent = [];
  input.on('data', bytes => {
    const request = JSON.parse(bytes.toString()); sent.push(request);
    assert.equal(readSubmissionIntent(root, intent.operationId).phase, 'sent');
    const stored = readWorkspace(root).tasks[0]; assert.equal(stored.taskId, task.taskId);
    let result;
    if (request.method === 'thread/start') {
      assert.equal(stored.threadId, null);
      result = { thread: { id: 'thread-1', cwd: root }, cwd: root, model: 'deepseek-v4-flash', modelProvider: 'deepseek',
        approvalPolicy: 'on-request', approvalsReviewer: 'user', instructionSources: [],
        sandbox: { type: 'workspaceWrite', networkAccess: false, writableRoots: [] } };
    } else {
      assert.equal(stored.threadId, 'thread-1'); assert.equal(stored.turnId, null);
      result = { turn: { id: 'turn-1', status: 'inProgress' } };
    }
    output.write(JSON.stringify({ id: request.id, result }) + '\n');
  });
  const transport = new CodexTransport(input, output, { notification() {}, request() {}, disconnected() {} });
  try {
    const result = await submitFirstTurn(root, task, intent, transport);
    assert.deepEqual(result, { threadId: 'thread-1', turnId: 'turn-1', instructionSources: [] });
    const stored = readWorkspace(root).tasks[0];
    assert.equal(stored.executionState, 'running'); assert.equal(stored.threadId, 'thread-1'); assert.equal(stored.turnId, 'turn-1');
    assert.equal(readSubmissionIntent(root, intent.operationId).phase, 'acknowledged');
    assert.equal(sent.length, 2);
    await assert.rejects(submitFirstTurn(root, { ...task, taskId: randomUUID() }, { ...intent, operationId: randomUUID() }, transport), /活动或未决/);
    assert.equal(sent.length, 2); assert.equal(readWorkspace(root).tasks.length, 1);
    const notification = { method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } };
    assert.equal(observeTurnCompletion(root, task.taskId, intent.operationId, { ...notification, method: 'turn/start' }), false);
    assert.equal(observeTurnCompletion(root, task.taskId, intent.operationId, { ...notification, params: { ...notification.params, threadId: 'other-thread' } }), false);
    assert.equal(observeTurnCompletion(root, task.taskId, intent.operationId, { ...notification, params: { ...notification.params, turn: { id: 'other-turn', status: 'completed' } } }), false);
    assert.equal(observeTurnCompletion(root, task.taskId, randomUUID(), notification), false);
    assert.throws(() => observeTurnCompletion(root, task.taskId, intent.operationId, { ...notification, params: { ...notification.params, turn: { id: 'turn-1', status: 'inProgress' } } }), /终态值无效/);
    assert.equal(readWorkspace(root).tasks[0].executionState, 'running');
    assert.equal(observeTurnCompletion(root, task.taskId, intent.operationId, notification), true);
    assert.equal(readWorkspace(root).tasks[0].executionState, 'completed');
    assert.equal(readSubmissionIntent(root, intent.operationId).phase, 'settled');
    assert.equal(observeTurnCompletion(root, task.taskId, intent.operationId, notification), false);
    assert.equal(observeTurnCompletion(root, task.taskId, intent.operationId, { ...notification, params: { ...notification.params, turn: { id: 'turn-1', status: 'failed' } } }), false);
    assert.equal(readWorkspace(root).tasks[0].executionState, 'completed');
  } finally { transport.close(); input.destroy(); output.destroy(); }
});

test('首次提交协调：turn 应答丢失保留 thread 与原输入，禁止自动补发或抢占', async () => {
  const { submitFirstTurn } = require('../../src/main/services/execution.ts');
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  const { readSubmissionIntent } = require('../../src/main/storage/tasks.ts');
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-04/coordinator-disconnect-'));
  const project = associateProject(root, root).project, time = new Date().toISOString();
  const task = { taskId: randomUUID(), projectId: project.projectId, directory: root, title: '失联任务',
    lastActivityAt: time, observedAt: time, executionState: 'submitting', threadId: null, turnId: null };
  const intent = { operationId: randomUUID(), text: '不要重复执行原始要求', modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID() };
  const input = new PassThrough(), output = new PassThrough(), sent = [];
  input.on('data', bytes => {
    const request = JSON.parse(bytes.toString()); sent.push(request);
    if (request.method === 'turn/start') { output.end(); return; }
    output.write(JSON.stringify({ id: request.id, result: {
      thread: { id: 'known-thread', cwd: root }, cwd: root, model: 'deepseek-v4-flash', modelProvider: 'deepseek',
      approvalPolicy: 'on-request', approvalsReviewer: 'user', instructionSources: [],
      sandbox: { type: 'workspaceWrite', networkAccess: false, writableRoots: [] },
    } }) + '\n');
  });
  const transport = new CodexTransport(input, output, { notification() {}, request() {}, disconnected() {} });
  try {
    await assert.rejects(submitFirstTurn(root, task, intent, transport), /断开/);
    const stored = readWorkspace(root).tasks[0];
    assert.equal(stored.executionState, 'reconciling');
    assert.equal(stored.threadId, 'known-thread'); assert.equal(stored.turnId, null);
    assert.equal(readSubmissionIntent(root, intent.operationId).phase, 'unknown');
    assert.equal(readSubmissionIntent(root, intent.operationId).text, intent.text);
    await assert.rejects(submitFirstTurn(root, task, intent, transport), /活动或未决/);
    assert.deepEqual(sent.map(value => value.method), ['thread/start', 'turn/start']);
    assert.equal(readWorkspace(root).tasks.length, 1);
  } finally { transport.close(); input.destroy(); output.destroy(); }
});
