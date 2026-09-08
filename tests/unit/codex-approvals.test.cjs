const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
require('ts-node').register({ transpileOnly: true });

test('原生审批：命令与文件按外层请求 ID 仅回应本次，不使用 approvalId 或扩大授权', async () => {
  const { parseApprovalRequest, answerApproval } = require('../../src/main/runtime/codex/approvals.ts');
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  for (const [method, decision, requestId] of [
    ['item/commandExecution/requestApproval', 'accept', 19], ['item/fileChange/requestApproval', 'decline', 'request-file'],
  ]) {
    const input = new PassThrough(), output = new PassThrough(), sent = [], approvals = [];
    input.on('data', bytes => sent.push(JSON.parse(bytes.toString())));
    const transport = new CodexTransport(input, output, { notification() {}, request: message => approvals.push(parseApprovalRequest(message)), disconnected() {} });
    try {
      output.write(JSON.stringify({ id: requestId, method, params: { kind: 'command', threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1',
        approvalId: 'not-the-rpc-id', startedAtMs: 1, environmentId: null, command: 'npm test', cwd: 'C:\\synthetic', reason: '需要运行验证',
        networkApprovalContext: { host: 'synthetic.invalid', protocol: 'https' }, grantRoot: 'C:\\synthetic' } }) + '\n');
      assert.equal(approvals[0].requestId, requestId); assert.equal(approvals[0].threadId, 'thread-1');
      if (method.includes('commandExecution')) assert.deepEqual(approvals[0].network, { host: 'synthetic.invalid', protocol: 'https' });
      else assert.equal(approvals[0].grantRoot, 'C:\\synthetic');
      await assert.rejects(answerApproval(transport, approvals[0], 'acceptForSession'), /仅支持本次/);
      assert.equal(sent.length, 0);
      await answerApproval(transport, approvals[0], decision);
      assert.deepEqual(sent, [{ id: requestId, result: { decision } }]);
      await assert.rejects(answerApproval(transport, approvals[0], decision), /失效/);
    } finally { transport.close(); input.destroy(); output.destroy(); }
  }
});
