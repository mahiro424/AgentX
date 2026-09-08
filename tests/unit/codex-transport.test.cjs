const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
require('ts-node').register({ transpileOnly: true });

test('原生审批：resolved 只使匹配会话的请求失效，旧请求不能再次回应', async () => {
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const input = new PassThrough(), output = new PassThrough(), sent = [], received = [];
  input.on('data', bytes => sent.push(JSON.parse(bytes.toString())));
  const transport = new CodexTransport(input, output, { notification: message => received.push(message), request() {}, disconnected() {} });
  try {
    output.write(JSON.stringify({ id: 'approval-1', method: 'item/fileChange/requestApproval', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1' } }) + '\n');
    output.write(JSON.stringify({ method: 'serverRequest/resolved', params: { threadId: 'other-thread', requestId: 'approval-1' } }) + '\n');
    await transport.respond('approval-1', { decision: 'decline' });
    output.write(JSON.stringify({ id: 'approval-2', method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-2' } }) + '\n');
    output.write(JSON.stringify({ method: 'serverRequest/resolved', params: { threadId: 'thread-1', requestId: 'approval-2' } }) + '\n');
    await assert.rejects(transport.respond('approval-2', { decision: 'accept' }), /失效/);
    assert.deepEqual(sent, [{ id: 'approval-1', result: { decision: 'decline' } }]);
    assert.equal(received.length, 2);
  } finally { transport.close(); input.destroy(); output.destroy(); }
});

test('Codex stdio：交错通知和逆序应答仍按请求 ID 配对，不把通知当作完成', async () => {
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const input = new PassThrough(), output = new PassThrough();
  const sent = [], notifications = [];
  input.setEncoding('utf8'); input.on('data', text => sent.push(JSON.parse(text)));
  const transport = new CodexTransport(input, output, { notification: value => notifications.push(value), request: () => {}, disconnected: () => {} });
  try {
    const first = transport.call('config/read', { includeLayers: true });
    const second = transport.call('thread/read', { threadId: 'synthetic-thread', includeTurns: true });
    output.write(JSON.stringify({ method: 'turn/completed', params: { threadId: 'synthetic-thread' } }) + '\n');
    const response = JSON.stringify({ id: sent[1].id, result: { value: '第二项中文' } }) + '\n';
    const bytes = Buffer.from(response);
    const split = bytes.indexOf(Buffer.from('中')) + 1;
    output.write(bytes.subarray(0, split)); output.write(bytes.subarray(split));
    output.write(JSON.stringify({ id: sent[0].id, result: { value: '第一项' } }) + '\n');
    assert.deepEqual(await first, { value: '第一项' });
    assert.deepEqual(await second, { value: '第二项中文' });
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].method, 'turn/completed');
    assert.equal(sent.length, 2);
  } finally { transport.close(); input.destroy(); output.destroy(); }
});

test('Codex stdio：断线使未决调用与审批失效，不重发也不重新接受调用', async () => {
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const input = new PassThrough(), output = new PassThrough(), sent = [], faults = [];
  input.setEncoding('utf8'); input.on('data', text => sent.push(JSON.parse(text)));
  const transport = new CodexTransport(input, output, { notification: () => {}, request: () => {}, disconnected: error => faults.push(error.message) });
  try {
    const pending = transport.call('turn/start', { threadId: 'synthetic-thread', input: [] });
    const rejected = assert.rejects(pending, /断开/);
    output.write('{"id":"approval-2","method":"item/fileChange/requestApproval","params":{}}\n');
    output.end(); await rejected;
    await assert.rejects(transport.respond('approval-2', { decision: 'accept' }), /断开/);
    await assert.rejects(transport.call('turn/start', {}), /断开/);
    assert.equal(sent.length, 1); assert.equal(faults.length, 1);
  } finally { transport.close(); input.destroy(); output.destroy(); }
});

test('Codex stdio：应答超时使连接进入核对，其他未决调用也不能继续猜测结果', async () => {
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const input = new PassThrough(), output = new PassThrough(), sent = [], faults = [];
  input.setEncoding('utf8'); input.on('data', text => sent.push(JSON.parse(text)));
  const transport = new CodexTransport(input, output, { notification: () => {}, request: () => {}, disconnected: error => faults.push(error.message) });
  try {
    const first = assert.rejects(transport.call('turn/start', {}, 5), /超时/);
    const second = assert.rejects(transport.call('config/read', {}, 1000), /超时/);
    await Promise.all([first, second]);
    output.write(JSON.stringify({ id: sent[0].id, result: { late: true } }) + '\n');
    await assert.rejects(transport.call('turn/start', {}), /超时/);
    assert.equal(sent.length, 2); assert.equal(faults.length, 1);
  } finally { transport.close(); input.destroy(); output.destroy(); }
});

test('Codex stdio：关闭后的迟到流错误不成为未处理异常', () => {
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const input = new PassThrough(), output = new PassThrough(), faults = [];
  const transport = new CodexTransport(input, output, { notification: () => {}, request: () => {}, disconnected: error => faults.push(error.message) });
  transport.close();
  try {
    assert.doesNotThrow(() => input.emit('error', new Error('synthetic-EPIPE')));
    assert.doesNotThrow(() => output.emit('error', new Error('synthetic-closed')));
    assert.equal(faults.length, 1);
  } finally { input.destroy(); output.destroy(); }
});

test('Codex stdio：混合请求与应答字段的消息拒绝分发，不形成审批', () => {
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const input = new PassThrough(), output = new PassThrough(), requests = [], faults = [];
  const transport = new CodexTransport(input, output, { notification: value => requests.push(value), request: value => requests.push(value), disconnected: error => faults.push(error.message) });
  try {
    output.write('{"id":1,"method":"item/fileChange/requestApproval","result":{"secret":"不应回显"}}\n');
    assert.equal(requests.length, 0);
    assert.equal(faults.length, 1);
    assert.doesNotMatch(faults[0], /不应回显/);
  } finally { transport.close(); input.destroy(); output.destroy(); }
});

test('Codex stdio：断线处理本身失败保持可观察且不泄露异常正文', t => {
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const input = new PassThrough(), output = new PassThrough(), logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
  const transport = new CodexTransport(input, output, { notification: () => {}, request: () => {}, disconnected: () => { throw new Error('synthetic-private-detail'); } });
  try {
    assert.doesNotThrow(() => output.emit('error', new Error('synthetic-EPIPE')));
    assert.equal(logs.length, 1);
    assert.match(logs[0], /状态尚未核对/);
    assert.doesNotMatch(logs[0], /synthetic-private-detail/);
  } finally { transport.close(); input.destroy(); output.destroy(); }
});

test('Codex stdio：服务端审批不自动响应，决定只能回原连接一次', async () => {
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const input = new PassThrough(), output = new PassThrough(), sent = [], requests = [];
  input.setEncoding('utf8'); input.on('data', text => sent.push(JSON.parse(text)));
  const transport = new CodexTransport(input, output, { notification: () => {}, request: value => requests.push(value), disconnected: () => {} });
  try {
    output.write(JSON.stringify({ id: 'approval-1', method: 'item/commandExecution/requestApproval', params: { threadId: 't', turnId: 'u' } }) + '\n');
    assert.equal(requests.length, 1); assert.equal(sent.length, 0);
    await transport.respond('approval-1', { decision: 'decline' });
    assert.deepEqual(sent, [{ id: 'approval-1', result: { decision: 'decline' } }]);
    await assert.rejects(transport.respond('approval-1', { decision: 'accept' }), /失效/);
    assert.equal(sent.length, 1);
  } finally { transport.close(); input.destroy(); output.destroy(); }
});
