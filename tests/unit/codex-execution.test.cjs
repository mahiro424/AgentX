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
