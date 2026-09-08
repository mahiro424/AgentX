const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PassThrough } = require('node:stream');
require('ts-node').register({ transpileOnly: true });

test('后台终止：分页核对归属，只终止指定执行项，之后重新查询确认消失', async () => {
  const { terminateBackgroundTerminals } = require('../../src/main/runtime/codex/execution.ts');
  const calls = []; let lists = 0;
  const transport = { call: async (method, params) => {
    calls.push({ method, params });
    if (method.endsWith('/terminate')) return { terminated: true };
    lists++;
    if (lists === 1) return { data: [{ itemId: 'mine', processId: '42' }], nextCursor: 'page2' };
    return { data: [{ itemId: 'other', processId: '99' }], nextCursor: null };
  } };
  await terminateBackgroundTerminals(transport, 'thread', new Set(['mine']));
  assert.deepEqual(calls.filter(call => call.method.endsWith('/terminate')), [
    { method: 'thread/backgroundTerminals/terminate', params: { threadId: 'thread', processId: '42' } },
  ]);
  assert.equal(lists, 3);
});

test('后台终止：请求成功但进程仍在时失败，不伪装清理完成', async () => {
  const { terminateBackgroundTerminals } = require('../../src/main/runtime/codex/execution.ts');
  await assert.rejects(terminateBackgroundTerminals({ call: async method => method.endsWith('/terminate')
    ? { terminated: true } : { data: [{ itemId: 'mine', processId: '42' }], nextCursor: null } }, 'thread', new Set(['mine'])), /仍在运行/);
});

test('补充协议：固定 expectedTurnId，拒绝后不降级为新轮次', async () => {
  const { steerTurn } = require('../../src/main/runtime/codex/execution.ts');
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const input = new PassThrough(), output = new PassThrough(), sent = [];
  input.on('data', bytes => {
    const request = JSON.parse(bytes.toString()); sent.push(request);
    output.write(JSON.stringify(sent.length === 1 ? { id: request.id, result: { turnId: 'active-turn' } }
      : { id: request.id, error: { code: -32602, message: 'synthetic-private-reason' } }) + '\n');
  });
  const transport = new CodexTransport(input, output, { notification() {}, request() {}, disconnected() {} });
  try {
    assert.deepEqual(await steerTurn(transport, 'thread-1', 'active-turn', '补充原始要求'), { turnId: 'active-turn' });
    await assert.rejects(steerTurn(transport, 'thread-1', 'active-turn', '第二次补充'), error => {
      assert.doesNotMatch(error.message, /synthetic-private-reason/); return true;
    });
    assert.deepEqual(sent.map(request => request.method), ['turn/steer', 'turn/steer']);
    assert.deepEqual(sent[0].params, { threadId: 'thread-1', expectedTurnId: 'active-turn', input: [{ type: 'text', text: '补充原始要求', text_elements: [] }] });
  } finally { transport.close(); input.destroy(); output.destroy(); }
});

test('首次执行协议：显式固定 Flash 与用户审批，返回关联而不报告任务完成', async () => {
  const { startThread, startTurn } = require('../../src/main/runtime/codex/execution.ts');
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const input = new PassThrough(), output = new PassThrough(), sent = [];
  const directory = path.resolve('.local-validation/m1-04');
  input.on('data', bytes => {
    const request = JSON.parse(bytes.toString()); sent.push(request);
    const result = request.method === 'thread/start'
      ? { thread: { id: 'thread-1', cwd: directory }, model: 'deepseek-v4-flash', modelProvider: 'deepseek', cwd: directory,
          approvalPolicy: 'on-request', approvalsReviewer: 'user', instructionSources: [],
          sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } }
      : { turn: { id: 'turn-1', status: 'inProgress' } };
    output.write(JSON.stringify({ id: request.id, result }) + '\n');
  });
  const transport = new CodexTransport(input, output, { notification() {}, request() {}, disconnected() {} });
  try {
    const thread = await startThread(transport, directory);
    assert.deepEqual(thread, { threadId: 'thread-1', instructionSources: [] });
    assert.deepEqual(await startTurn(transport, thread.threadId, '修复合成项目'), { turnId: 'turn-1' });
    assert.deepEqual(sent.map(x => x.method), ['thread/start', 'turn/start']);
    assert.equal(sent[0].params.model, 'deepseek-v4-flash');
    assert.equal(sent[0].params.approvalsReviewer, 'user');
    assert.equal(sent[0].params.ephemeral, false);
    assert.equal(sent[1].params.model, 'deepseek-v4-flash');
    assert.deepEqual(sent[1].params.input, [{ type: 'text', text: '修复合成项目', text_elements: [] }]);
  } finally { transport.close(); input.destroy(); output.destroy(); }
});

test('首次执行协议：模型或权限不符时不发送输入；无效轮次应答不自动重发', async () => {
  const { startThread, startTurn } = require('../../src/main/runtime/codex/execution.ts');
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const directory = path.resolve('.local-validation/m1-04');
  const valid = { thread: { id: 'thread-1', cwd: directory }, model: 'deepseek-v4-flash', modelProvider: 'deepseek', cwd: directory,
    approvalPolicy: 'on-request', approvalsReviewer: 'user', instructionSources: [],
    sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: false } };
  for (const result of [
    { ...valid, model: 'unsupported-synthetic' }, { ...valid, approvalsReviewer: 'auto_review' },
    { ...valid, cwd: path.dirname(directory) }, { ...valid, sandbox: { ...valid.sandbox, networkAccess: true } },
    { ...valid, sandbox: { ...valid.sandbox, writableRoots: [path.dirname(directory)] } },
    { turn: { id: null, status: 'completed' } },
  ]) {
    const input = new PassThrough(), output = new PassThrough(), sent = [];
    input.on('data', bytes => {
      const request = JSON.parse(bytes.toString()); sent.push(request);
      output.write(JSON.stringify({ id: request.id, result }) + '\n');
    });
    const transport = new CodexTransport(input, output, { notification() {}, request() {}, disconnected() {} });
    try {
      if ('turn' in result) await assert.rejects(startTurn(transport, 'thread-1', '原始要求'), /轮次关联/);
      else await assert.rejects(startThread(transport, directory), /拒绝发送任务/);
      assert.equal(sent.length, 1);
      if (!('turn' in result)) assert.equal(sent[0].method, 'thread/start');
    } finally { transport.close(); input.destroy(); output.destroy(); }
  }
});


test('历史读取：只调用公开 thread/read，保留已结束轮次和命令原始退出码', async () => {
  const { readThreadHistory } = require('../../src/main/runtime/codex/history.ts');
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const input = new PassThrough(), output = new PassThrough(), sent = [];
  const directory = path.resolve('.local-validation/m1-05');
  input.on('data', bytes => {
    const request = JSON.parse(bytes.toString()); sent.push(request);
    output.write(JSON.stringify({ id: request.id, result: { thread: { id: 'thread-1', cwd: directory, turns: [{
      id: 'turn-1', status: 'completed', itemsView: 'full', error: null, items: [
        { type: 'agentMessage', id: 'message-1', text: '检查结果', phase: 'final_answer' },
        { type: 'commandExecution', id: 'command-1', command: 'node --test', cwd: directory,
          status: 'failed', aggregatedOutput: '合成测试失败', exitCode: 1, durationMs: 12 },
      ],
    }] } } }) + '\n');
  });
  const transport = new CodexTransport(input, output, { notification() {}, request() {}, disconnected() {} });
  try {
    const history = await readThreadHistory(transport, 'thread-1', directory);
    assert.equal(history.threadId, 'thread-1');
    assert.equal(history.turns[0].turnId, 'turn-1');
    assert.equal(history.turns[0].status, 'completed');
    assert.equal(history.turns[0].items[0].text, '检查结果');
    assert.equal(history.turns[0].items[1].exitCode, 1);
    assert.equal(history.turns[0].items[1].output, '合成测试失败');
    assert.deepEqual(sent.map(({ method, params }) => ({ method, params })), [
      { method: 'thread/read', params: { threadId: 'thread-1', includeTurns: true } },
    ]);
  } finally { transport.close(); input.destroy(); output.destroy(); }
});


test('历史读取：保留用户文本顺序，隐藏推理正文且明确记录未呈现类型', async () => {
  const { readThreadHistory } = require('../../src/main/runtime/codex/history.ts');
  const directory = path.resolve('.local-validation/m1-05');
  const history = await readThreadHistory({ call: async () => ({ thread: { id: 'thread-1', cwd: directory, turns: [{
    id: 'turn-1', status: 'interrupted', itemsView: 'full', error: null, items: [
      { type: 'userMessage', id: 'user-1', content: [{ type: 'text', text: '原始要求', text_elements: [] }] },
      { type: 'reasoning', id: 'reason-1', content: ['PRIVATE_REASONING'] },
      { type: 'agentMessage', id: 'agent-1', text: '部分结果', phase: 'commentary' },
    ],
  }] } }) }, 'thread-1', directory);
  assert.deepEqual(history.turns[0].items.map(item => [item.kind, item.text]), [['userMessage', '原始要求'], ['message', '部分结果']]);
  assert.deepEqual(history.turns[0].unrepresentedItemTypes, ['reasoning']);
  assert.doesNotMatch(JSON.stringify(history), /PRIVATE_REASONING/);
});


test('历史读取边界：拒绝错会话、错目录、不完整或重复记录，RPC 失败不返回空历史', async () => {
  const { readThreadHistory } = require('../../src/main/runtime/codex/history.ts');
  const directory = path.resolve('.local-validation/m1-05');
  const turn = { id: 'turn-1', status: 'completed', itemsView: 'full', items: [], error: null };
  const valid = { id: 'thread-1', cwd: directory, turns: [turn] };
  for (const thread of [
    { ...valid, id: 'foreign-thread' }, { ...valid, cwd: path.dirname(directory) }, { ...valid, turns: null },
    { ...valid, turns: [{ ...turn, itemsView: 'summary' }] }, { ...valid, turns: [turn, turn] },
    { ...valid, turns: [{ ...turn, status: 'invented' }] },
    { ...valid, turns: [{ ...turn, items: [{ type: 'agentMessage', id: 'same', text: 'a' }, { type: 'agentMessage', id: 'same', text: 'b' }] }] },
  ]) {
    let calls = 0;
    await assert.rejects(readThreadHistory({ call: async () => { calls++; return { thread }; } }, 'thread-1', directory), /历史/);
    assert.equal(calls, 1);
  }
  await assert.rejects(readThreadHistory({ call: async () => { throw new Error('合成 RPC 读取失败'); } }, 'thread-1', directory), /RPC 读取失败/);
});
