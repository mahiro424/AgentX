const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PassThrough } = require('node:stream');
require('ts-node').register({ transpileOnly: true });

test('执行项校验：错误状态类型不可被转换成成功或失败状态', () => {
  const { parseCommandEvent, parseFileChangeEvent } = require('../../src/main/runtime/codex/events.ts');
  const notification = item => ({ method: 'item/completed', params: { threadId: 'thread', turnId: 'turn', item } });
  assert.throws(() => parseCommandEvent(notification({ type: 'commandExecution', id: 'command', command: 'npm test', cwd: 'C:\\fixture',
    status: ['failed'], aggregatedOutput: null, exitCode: null, durationMs: null })), /无效/);
  assert.throws(() => parseFileChangeEvent(notification({ type: 'fileChange', id: 'file', status: ['completed'], changes: [] })), /无效/);
});

test('正文流：早到片段归属当前轮次，完成文本替换累计片段，旧轮和断线片段不混入', async () => {
  const { FirstTurnSession } = require('../../src/main/services/execution.ts');
  const { associateProject } = require('../../src/main/storage/projects.ts');
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-04/session-items-'));
  const project = associateProject(root, root).project, now = new Date().toISOString();
  const task = { taskId: randomUUID(), projectId: project.projectId, directory: root, title: '正文流',
    lastActivityAt: now, observedAt: now, executionState: 'submitting', threadId: null, turnId: null };
  const session = new FirstTurnSession(root, task, { operationId: randomUUID(), text: '合成输入',
    modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID() });
  const input = new PassThrough(), output = new PassThrough();
  const event = (method, extra, turnId = 'turn-text') => output.write(JSON.stringify({ method,
    params: { threadId: 'thread-text', turnId, ...extra } }) + '\n');
  input.on('data', bytes => {
    const request = JSON.parse(bytes.toString());
    if (request.method === 'thread/start') output.write(JSON.stringify({ id: request.id, result: {
      thread: { id: 'thread-text', cwd: root }, cwd: root, model: 'deepseek-v4-flash', modelProvider: 'deepseek',
      approvalPolicy: 'on-request', approvalsReviewer: 'user', instructionSources: [],
      sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: false },
    } }) + '\n');
    else {
      event('item/started', { item: { type: 'agentMessage', id: 'message-1', text: '', phase: 'commentary' } });
      event('item/agentMessage/delta', { itemId: 'message-1', delta: '正在' });
      event('item/agentMessage/delta', { itemId: 'message-1', delta: '检查' });
      output.write(JSON.stringify({ id: request.id, result: { turn: { id: 'turn-text' } } }) + '\n');
    }
  });
  const transport = new CodexTransport(input, output, { notification: message => session.notification(message),
    request: message => session.request(message), disconnected: () => session.disconnected() });
  try {
    await session.submit(transport);
    assert.equal(session.readItems()[0].text, '正在检查');
    const copy = session.readItems(); copy[0].text = '篡改快照';
    assert.equal(session.readItems()[0].text, '正在检查');
    event('item/agentMessage/delta', { itemId: 'message-1', delta: '旧轮次' }, 'old-turn');
    assert.equal(session.readItems().length, 1);
    event('item/completed', { item: { type: 'agentMessage', id: 'message-1', text: '检查完成', phase: 'commentary' } });
    event('item/agentMessage/delta', { itemId: 'message-1', delta: '迟到片段' });
    assert.equal(session.readItems()[0].text, '检查完成');
    assert.equal(session.readItems()[0].status, 'completed');
    event('item/started', { item: { type: 'commandExecution', id: 'command-1', command: 'npm test', cwd: root,
      status: 'inProgress', aggregatedOutput: null, exitCode: null, durationMs: null } });
    event('item/commandExecution/outputDelta', { itemId: 'command-1', delta: '测试开始\n' });
    assert.equal(session.readItems().find(item => item.itemId === 'command-1').output, '测试开始\n');
    event('item/completed', { item: { type: 'commandExecution', id: 'command-1', command: 'npm test', cwd: root,
      status: 'failed', aggregatedOutput: '测试失败\n', exitCode: 1, durationMs: 20 } });
    event('item/commandExecution/outputDelta', { itemId: 'command-1', delta: '迟到输出' });
    const command = session.readItems().find(item => item.itemId === 'command-1');
    assert.equal(command.status, 'failed'); assert.equal(command.exitCode, 1);
    assert.equal(command.output, '测试失败\n'); assert.equal(command.command, 'npm test');
    event('item/started', { item: { type: 'fileChange', id: 'file-1', status: 'inProgress', changes: [
      { path: path.join(root, 'sum.js'), kind: { type: 'update', move_path: null }, diff: '-a-b\n+a+b' },
    ] } });
    const file = session.readItems().find(item => item.itemId === 'file-1');
    assert.equal(file.status, 'running'); assert.equal(file.changes[0].diff, '-a-b\n+a+b');
    file.changes[0].diff = '篡改';
    assert.equal(session.readItems().find(item => item.itemId === 'file-1').changes[0].diff, '-a-b\n+a+b');
    event('item/completed', { item: { type: 'fileChange', id: 'file-1', status: 'declined', changes: [] } });
    assert.equal(session.readItems().find(item => item.itemId === 'file-1').status, 'declined');
    event('item/started', { item: { type: 'agentMessage', id: 'message-2', text: '下一步', phase: 'final_answer' } });
    session.disconnected();
    event('item/agentMessage/delta', { itemId: 'message-2', delta: '旧连接' });
    assert.equal(session.readItems().find(item => item.itemId === 'message-2').text, '下一步');
  } finally { transport.close(); input.destroy(); output.destroy(); }
});
