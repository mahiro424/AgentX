const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
require('ts-node').register({ transpileOnly: true });

async function fixture() {
  const tasks = require('../../src/main/storage/tasks.ts');
  const { associateProject } = require('../../src/main/storage/projects.ts');
  const { captureWorkspace, captureGitState } = require('../../src/main/services/workspace-results.ts');
  const { saveWorkspaceBaseline } = require('../../src/main/storage/results.ts');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'agentx-artifact-')));
  const directory = path.join(root, 'project'); await fs.mkdir(directory);
  const project = associateProject(root, directory).project;
  const taskId = randomUUID(), operationId = randomUUID(), now = new Date().toISOString();
  await saveWorkspaceBaseline(root, { taskId, operationId }, await captureWorkspace(directory), await captureGitState(directory));
  tasks.beginTaskSubmission(root, { taskId, projectId: project.projectId, title: '产物检查', directory,
    executionState: 'submitting', threadId: null, turnId: null, lastActivityAt: now, observedAt: now },
  { operationId, text: '生成笔记', modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID() });
  tasks.markSubmissionDispatched(root, taskId, operationId);
  tasks.bindSubmissionThread(root, taskId, operationId, 'artifact-thread');
  tasks.acknowledgeSubmission(root, taskId, operationId, 'artifact-thread', 'artifact-turn');
  tasks.settleTaskTurn(root, taskId, operationId, 'artifact-thread', 'artifact-turn', 'completed');
  return { root, directory, taskId, operationId, request: { taskId, turnId: 'artifact-turn' } };
}

test('真实产物：检查实际新增文件才建立稳定结果 ID，按任务和来源轮次预览，不接受任意路径', async () => {
  const { readTaskResults } = require('../../src/main/services/task-results.ts');
  const { readFilePreview } = require('../../src/main/services/file-preview.ts');
  const value = await fixture();
  assert.deepEqual((await readTaskResults(value.root, value.request)).artifacts, []);
  const text = '# 新笔记\n已核对两份材料\n', filename = path.join(value.directory, '笔记.md');
  await fs.writeFile(filename, text);
  const result = await readTaskResults(value.root, value.request), artifact = result.artifacts[0];
  assert.equal(result.artifacts.length, 1);
  assert.equal(artifact.taskId, value.taskId); assert.equal(artifact.turnId, value.request.turnId);
  assert.equal(artifact.operationId, value.operationId); assert.equal(artifact.path, '笔记.md');
  assert.match(artifact.resultId, /^[a-f0-9]{64}$/);
  const source = { kind: 'result', taskId: value.taskId, resultId: artifact.resultId };
  const preview = await readFilePreview(value.root, source);
  assert.equal(preview.text, text); assert.equal(preview.path, filename); assert.equal(preview.status, 'ready');
  assert.equal(preview.turnId, value.request.turnId); assert.equal(preview.version.sha256, artifact.sha256);
  assert.equal((await readTaskResults(value.root, value.request)).artifacts[0].resultId, artifact.resultId);
  await assert.rejects(readFilePreview(value.root, { ...source, taskId: randomUUID() }), /任务|结果|归属/);
  await assert.rejects(readFilePreview(value.root, { ...source, path: filename }), /请求/);
});

test('产物续轮：同路径的新旧版本分别保留，重读旧引用不冒充新内容，删除不清除来源', async () => {
  const { readTaskResults } = require('../../src/main/services/task-results.ts');
  const { readFilePreview, openFilePreview } = require('../../src/main/services/file-preview.ts');
  const { readWorkspace } = require('../../src/main/storage/projects.ts');
  const tasks = require('../../src/main/storage/tasks.ts');
  const scan = require('../../src/main/services/workspace-results.ts');
  const { saveWorkspaceBaseline } = require('../../src/main/storage/results.ts');
  const value = await fixture(), filename = path.join(value.directory, 'result.txt');
  await fs.writeFile(filename, '第一版内容');
  const first = (await readTaskResults(value.root, value.request)).artifacts[0];
  const originalSource = { kind: 'result', taskId: value.taskId, resultId: first.resultId };
  const previous = readWorkspace(value.root).tasks[0], operationId = randomUUID();
  await saveWorkspaceBaseline(value.root, { taskId: value.taskId, operationId }, await scan.captureWorkspace(value.directory), await scan.captureGitState(value.directory));
  tasks.beginTaskContinuation(value.root, previous, { operationId, text: '追加修改', modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID() });
  tasks.markSubmissionDispatched(value.root, value.taskId, operationId);
  tasks.acknowledgeSubmission(value.root, value.taskId, operationId, previous.threadId, 'artifact-next');
  assert.equal((await readFilePreview(value.root, originalSource)).text, '第一版内容');
  await fs.writeFile(filename, '第二版增补内容');
  const stale = await readFilePreview(value.root, originalSource);
  assert.equal(stale.status, 'changed'); assert.equal(stale.text, null); assert.equal(stale.version.sha256, first.sha256);
  let opened = 0;
  await assert.rejects(openFilePreview(value.root, { source: originalSource, action: 'open' }, { openPath: async () => { opened++; return ''; }, showItemInFolder() {} }), /变化/);
  assert.equal(opened, 0);
  tasks.settleTaskTurn(value.root, value.taskId, operationId, previous.threadId, 'artifact-next', 'completed');
  const request = { taskId: value.taskId, turnId: 'artifact-next' }, result = await readTaskResults(value.root, request);
  assert.equal(result.artifacts.length, 2);
  const latest = result.artifacts.find(item => item.turnId === 'artifact-next');
  assert.notEqual(latest.resultId, first.resultId);
  assert.deepEqual(result.artifacts.find(item => item.resultId === first.resultId), first);
  assert.equal((await readFilePreview(value.root, { ...originalSource, resultId: latest.resultId })).text, '第二版增补内容');
  await fs.unlink(filename);
  assert.equal((await readFilePreview(value.root, originalSource)).status, 'missing');
  assert.equal((await readTaskResults(value.root, request)).artifacts.length, 2);
});

test('产物引用错误：损坏或缺失不能伪装空结果，路径被目录链接替换时不读取外部内容', async () => {
  const { readTaskResults } = require('../../src/main/services/task-results.ts');
  const { readFilePreview, openFilePreview } = require('../../src/main/services/file-preview.ts');
  const value = await fixture(), output = path.join(value.directory, 'output');
  await fs.mkdir(output); await fs.writeFile(path.join(output, 'note.txt'), '可信的已检查字节');
  const artifact = (await readTaskResults(value.root, value.request)).artifacts[0];
  const source = { kind: 'result', taskId: value.taskId, resultId: artifact.resultId };
  const metadata = path.join(value.root, 'results', value.taskId, `${artifact.resultId}.json`), original = await fs.readFile(metadata);
  await fs.writeFile(metadata, '{未完整写入');
  await assert.rejects(readFilePreview(value.root, source), /损坏|完整/);
  await assert.rejects(readTaskResults(value.root, value.request), /损坏|完整/);
  await fs.unlink(metadata);
  await assert.rejects(readFilePreview(value.root, source), /引用缺失/);
  await fs.writeFile(metadata, original);
  const external = path.join(value.root, 'external'); await fs.mkdir(external); await fs.writeFile(path.join(external, 'note.txt'), '不应读取的外部字节');
  await fs.rename(output, output + '-original');
  await fs.symlink(external, output, process.platform === 'win32' ? 'junction' : 'dir');
  const blocked = await readFilePreview(value.root, source);
  assert.equal(blocked.status, 'changed'); assert.equal(blocked.text, null);
  let opened = false;
  await assert.rejects(openFilePreview(value.root, { source, action: 'open' }, { openPath: async () => { opened = true; return ''; }, showItemInFolder() {} }), /变化/);
  assert.equal(opened, false);
  assert.equal(await fs.readFile(path.join(output + '-original', 'note.txt'), 'utf8'), '可信的已检查字节');
});
