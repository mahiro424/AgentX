const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: true });

test('文件补丁更新：保留引擎修订后的审批范围，不将补丁提议当作完成', () => {
  const { parseFileChangeEvent } = require('../../src/main/runtime/codex/events.ts');
  const event = { method: 'item/fileChange/patchUpdated', params: { threadId: 'thread', turnId: 'turn', itemId: 'file-item',
    changes: [{ path: 'src/example.ts', kind: { type: 'update', move_path: null }, diff: '-previous\n+updated' }] } };
  const result = parseFileChangeEvent(event);
  assert.equal(result?.status, 'running');
  assert.equal(result.itemId, 'file-item');
  assert.deepEqual(result.changes, [{ path: 'src/example.ts', operation: 'update', movePath: null, diff: '-previous\n+updated' }]);
  assert.throws(() => parseFileChangeEvent({ ...event, params: { ...event.params, changes: [{ path: 'src/example.ts' }] } }), /文件/);
});

test('文件补丁归属：修订更新同一执行项，已完成项和其他轮次不可被迟到补丁改写', async () => {
  const fs = require('node:fs/promises'), path = require('node:path'), { randomUUID } = require('node:crypto');
  const { FirstTurnSession } = require('../../src/main/services/execution.ts');
  const { associateProject } = require('../../src/main/storage/projects.ts');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-04/patch-session-'));
  const project = associateProject(root, root).project, now = new Date().toISOString();
  const session = new FirstTurnSession(root, { taskId: randomUUID(), projectId: project.projectId, directory: root, title: '补丁修订',
    lastActivityAt: now, observedAt: now, executionState: 'submitting', threadId: null, turnId: null },
  { operationId: randomUUID(), text: '合成目标', modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID() });
  await session.submit({ call: async method => method === 'thread/start'
    ? { thread: { id: 'thread', cwd: root }, cwd: root, model: 'deepseek-v4-flash', modelProvider: 'deepseek', approvalPolicy: 'on-request',
      approvalsReviewer: 'user', instructionSources: [], sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: false } }
    : { turn: { id: 'turn' } } });
  const changes = diff => [{ path: 'src/file.ts', kind: { type: 'update', move_path: null }, diff }];
  session.notification({ method: 'item/started', params: { threadId: 'thread', turnId: 'turn',
    item: { type: 'fileChange', id: 'file', status: 'inProgress', changes: changes('初稿') } } });
  const patch = (diff, turnId = 'turn') => ({ method: 'item/fileChange/patchUpdated', params: { threadId: 'thread', turnId, itemId: 'file', changes: changes(diff) } });
  session.notification(patch('已修订'));
  assert.equal(session.readItems()[0].changes[0].diff, '已修订');
  session.notification(patch('其他轮次', 'old-turn'));
  assert.equal(session.readItems()[0].changes[0].diff, '已修订');
  session.notification({ method: 'item/completed', params: { threadId: 'thread', turnId: 'turn',
    item: { type: 'fileChange', id: 'file', status: 'completed', changes: changes('最终报告') } } });
  session.notification(patch('迟到修订'));
  assert.equal(session.readItems()[0].changes[0].diff, '最终报告');
  assert.equal(session.readItems()[0].status, 'completed');
});
