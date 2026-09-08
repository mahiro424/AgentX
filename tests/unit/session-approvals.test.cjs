const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PassThrough } = require('node:stream');
require('ts-node').register({ transpileOnly: true });

test('会话审批：早到请求按轮次绑定，多项分别回应，产品标识不暴露 RPC id', async () => {
  const { FirstTurnSession } = require('../../src/main/services/execution.ts');
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-04/session-approvals-'));
  const project = associateProject(root, root).project, now = new Date().toISOString();
  const task = { taskId: randomUUID(), projectId: project.projectId, directory: root, title: '审批任务', lastActivityAt: now,
    observedAt: now, executionState: 'submitting', threadId: null, turnId: null };
  const intent = { operationId: randomUUID(), text: '合成任务', modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID() };
  const session = new FirstTurnSession(root, task, intent);
  const input = new PassThrough(), output = new PassThrough(), responses = [];
  input.on('data', bytes => {
    const request = JSON.parse(bytes.toString());
    if ('result' in request) {
      responses.push(request);
      output.write(JSON.stringify({ method: 'serverRequest/resolved', params: { threadId: 'thread-approval', requestId: request.id } }) + '\n'); return;
    }
    if (request.method === 'turn/interrupt') { output.write(JSON.stringify({ id: request.id, result: {} }) + '\n'); return; }
    if (request.method === 'thread/backgroundTerminals/list') { output.write(JSON.stringify({ id: request.id, result: { data: [], nextCursor: null } }) + '\n'); return; }
    if (request.method === 'thread/start') output.write(JSON.stringify({ id: request.id, result: {
      thread: { id: 'thread-approval', cwd: root }, cwd: root, model: 'deepseek-v4-flash', modelProvider: 'deepseek', approvalPolicy: 'on-request',
      approvalsReviewer: 'user', instructionSources: [], sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: false },
    } }) + '\n');
    else {
      for (const [id, method] of [['command-request', 'item/commandExecution/requestApproval'], [12, 'item/fileChange/requestApproval']])
        output.write(JSON.stringify({ id, method, params: { kind: 'command', threadId: 'thread-approval', turnId: 'turn-approval', itemId: String(id), startedAtMs: 1, command: 'npm test' } }) + '\n');
      output.write(JSON.stringify({ id: request.id, result: { turn: { id: 'turn-approval', status: 'inProgress' } } }) + '\n');
    }
  });
  const transport = new CodexTransport(input, output, { notification: message => session.notification(message), request: message => session.request(message), disconnected: () => session.disconnected() });
  try {
    await session.submit(transport);
    const approvals = session.readApprovals(); assert.equal(approvals.length, 2);
    assert.equal(approvals.every(value => !('requestId' in value) && value.status === 'pending'), true);
    assert.equal(readWorkspace(root).tasks[0].executionState, 'waitingApproval');
    await session.answer(approvals[0].approvalToken, 'accept');
    assert.equal(readWorkspace(root).tasks[0].executionState, 'waitingApproval');
    await assert.rejects(session.answer(approvals[0].approvalToken, 'accept'), /失效/);
    await session.answer(approvals[1].approvalToken, 'decline');
    assert.equal(readWorkspace(root).tasks[0].executionState, 'running');
    assert.deepEqual(responses, [{ id: 'command-request', result: { decision: 'accept' } }, { id: 12, result: { decision: 'decline' } }]);
    const requestApproval = (id, threadId = 'thread-approval') => output.write(JSON.stringify({ id, method: 'item/fileChange/requestApproval',
      params: { threadId, turnId: 'turn-approval', itemId: `item-${id}`, startedAtMs: 2 } }) + '\n');
    requestApproval('foreign', 'other-thread');
    assert.equal(session.readApprovals().length, 2);
    assert.equal(readWorkspace(root).tasks[0].executionState, 'running');
    requestApproval('resolved-externally');
    const external = session.readApprovals().find(value => value.itemId === 'item-resolved-externally');
    output.write(JSON.stringify({ method: 'serverRequest/resolved', params: { threadId: 'thread-approval', requestId: 'resolved-externally' } }) + '\n');
    await assert.rejects(session.answer(external.approvalToken, 'accept'), /失效/);
    requestApproval('pending-at-stop');
    const stopping = session.stop();
    const stopped = session.readApprovals().find(value => value.itemId === 'item-pending-at-stop');
    assert.equal(stopped.status, 'stale');
    await assert.rejects(session.answer(stopped.approvalToken, 'accept'), /失效/);
    output.write(JSON.stringify({ method: 'turn/completed', params: { threadId: 'thread-approval', turn: { id: 'turn-approval', status: 'completed' } } }) + '\n');
    await stopping;
    requestApproval('late-after-terminal');
    const late = session.readApprovals().find(value => value.itemId === 'item-late-after-terminal');
    assert.equal(late.status, 'stale');
    await assert.rejects(session.answer(late.approvalToken, 'accept'), /失效/);
    assert.equal(responses.length, 2);
    session.disconnected();
    await assert.rejects(session.answer(approvals[1].approvalToken, 'accept'), /失效/);
  } finally { transport.close(); input.destroy(); output.destroy(); }
});
