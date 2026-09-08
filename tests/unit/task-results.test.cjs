const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
require('ts-node').register({ transpileOnly: true });

async function fixture() {
  const { associateProject } = require('../../src/main/storage/projects.ts');
  const tasks = require('../../src/main/storage/tasks.ts');
  const { captureWorkspace, captureGitState } = require('../../src/main/services/workspace-results.ts');
  const { saveWorkspaceBaseline } = require('../../src/main/storage/results.ts');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-05/task-results-'));
  const directory = path.join(root, 'project'); await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'source.txt'), '原始内容\n');
  const project = associateProject(root, directory).project;
  const taskId = randomUUID(), operationId = randomUUID(), now = new Date().toISOString();
  const task = { taskId, projectId: project.projectId, title: '结果检查', directory,
    executionState: 'submitting', threadId: null, turnId: null, lastActivityAt: now, observedAt: now };
  await saveWorkspaceBaseline(root, { taskId, operationId }, await captureWorkspace(directory), await captureGitState(directory));
  tasks.beginTaskSubmission(root, task, { operationId, text: '检查项目', modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID() });
  tasks.markSubmissionDispatched(root, taskId, operationId);
  tasks.bindSubmissionThread(root, taskId, operationId, 'result-thread');
  tasks.acknowledgeSubmission(root, taskId, operationId, 'result-thread', 'result-turn');
  tasks.settleTaskTurn(root, taskId, operationId, 'result-thread', 'result-turn', 'completed');
  return { root, directory, taskId, operationId, request: { taskId, turnId: 'result-turn' } };
}

test('noChanges 产品接缝：实际扫描匹配轮次基线，无变化才返回空清单', async () => {
  const { readTaskResults } = require('../../src/main/services/task-results.ts');
  const value = await fixture();
  const result = await readTaskResults(value.root, value.request);
  assert.equal(result.taskId, value.taskId); assert.equal(result.operationId, value.operationId);
  assert.equal(result.turnId, 'result-turn'); assert.equal(result.directory, value.directory);
  assert.equal(result.complete, true); assert.deepEqual(result.changes, []);
  assert.ok(Date.parse(result.observedAt) >= Date.parse(result.baselineAt));
  assert.deepEqual(result.excludedNames, ['.git', 'node_modules']);
  await assert.rejects(readTaskResults(value.root, { ...value.request, path: 'C:\\Windows' }), /结果读取请求无效/);
  await assert.rejects(readTaskResults(value.root, { ...value.request, turnId: 'foreign-turn' }), /轮次/);
  await fs.unlink(path.join(value.root, 'results', value.operationId + '.baseline.json'));
  await assert.rejects(readTaskResults(value.root, value.request), /基线/);
});

test('结果范围：真实新增、删除、二进制和读取超限分别保留，不宣称完整归因', async () => {
  const { readTaskResults } = require('../../src/main/services/task-results.ts');
  const value = await fixture();
  await fs.unlink(path.join(value.directory, 'source.txt'));
  await fs.writeFile(path.join(value.directory, 'binary.bin'), Buffer.from([0, 1, 2]));
  await fs.writeFile(path.join(value.directory, 'large.txt'), Buffer.alloc(1024 * 1024 + 1, 65));
  const result = await readTaskResults(value.root, value.request);
  assert.equal(result.complete, false);
  assert.equal(result.changes.find(change => change.path === 'source.txt').operation, 'delete');
  const binary = result.changes.find(change => change.path === 'binary.bin');
  assert.equal(binary.operation, 'add'); assert.equal(binary.after.text, null);
  assert.equal(result.changes.some(change => change.path === 'large.txt'), false);
  assert.deepEqual(result.issues, [{ path: 'large.txt', reason: 'limit' }]);
});

test('v7 迁移：原会话、意图和一致性备份保留，缺失的轮次关联不按时间猜测', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const { readTurnOperation, readSubmissionIntent } = require('../../src/main/storage/tasks.ts');
  const { readWorkspace } = require('../../src/main/storage/projects.ts');
  const { readTaskResults } = require('../../src/main/services/task-results.ts');
  const value = await fixture(), before = readWorkspace(value.root);
  const database = new DatabaseSync(path.join(value.root, 'agentx.db'));
  try { database.exec('ALTER TABLE tasks DROP COLUMN pinned_at; ALTER TABLE tasks DROP COLUMN organization_revision; DROP TABLE runtime_leases; DROP INDEX execution_intents_turn; ALTER TABLE execution_intents DROP COLUMN turn_id; PRAGMA user_version=7'); }
  finally { database.close(); }
  assert.equal(readTurnOperation(value.root, value.taskId, value.request.turnId), null);
  assert.deepEqual(readWorkspace(value.root), before);
  assert.equal(readSubmissionIntent(value.root, value.operationId).phase, 'settled');
  await assert.rejects(readTaskResults(value.root, value.request), /没有已确认的基线关联/);
  const backups = (await fs.readdir(value.root)).filter(name => /^agentx\.before-v11\..+\.db$/.test(name));
  assert.equal(backups.length, 1);
  const previous = new DatabaseSync(path.join(value.root, backups[0]), { readOnly: true });
  try {
    assert.equal(previous.prepare('PRAGMA user_version').get().user_version, 7);
    assert.equal(previous.prepare('SELECT operation_id FROM execution_intents').get().operation_id, value.operationId);
  } finally { previous.close(); }
});
