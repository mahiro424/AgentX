const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
require('ts-node').register({ transpileOnly: true });

test('基线持久化：按任务和操作绑定，重读保留修改前文本且不覆盖既有基线', async () => {
  const { captureWorkspace, captureGitState } = require('../../src/main/services/workspace-results.ts');
  const { saveWorkspaceBaseline, readWorkspaceBaseline } = require('../../src/main/storage/results.ts');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-05/result-storage-'));
  const directory = path.join(root, 'project'), data = path.join(root, 'data');
  await fs.mkdir(directory); await fs.mkdir(data);
  await fs.writeFile(path.join(directory, 'main.txt'), '执行前人工内容');
  const binding = { taskId: randomUUID(), operationId: randomUUID() };
  const snapshot = await captureWorkspace(directory), git = await captureGitState(directory);
  await saveWorkspaceBaseline(data, binding, snapshot, git);
  await fs.writeFile(path.join(directory, 'main.txt'), '执行后内容');
  const restored = await readWorkspaceBaseline(data, binding);
  assert.equal(restored.snapshot.files[0].text, '执行前人工内容');
  assert.equal(restored.snapshot.directory, snapshot.directory);
  const exec = require('node:util').promisify(require('node:child_process').execFile);
  const child = await exec(process.execPath, ['-e', `require('ts-node').register({transpileOnly:true});require('./src/main/storage/results.ts').readWorkspaceBaseline(process.argv[1],{taskId:process.argv[2],operationId:process.argv[3]}).then(value=>process.stdout.write(value.snapshot.files[0].text)).catch(()=>{process.exitCode=1;});`, data, binding.taskId, binding.operationId], { cwd: path.resolve('.'), windowsHide: true });
  assert.equal(child.stdout, '执行前人工内容');
  await assert.rejects(saveWorkspaceBaseline(data, binding, await captureWorkspace(directory), git), /已存在/);
  assert.equal((await readWorkspaceBaseline(data, binding)).snapshot.files[0].text, '执行前人工内容');
  assert.deepEqual(await fs.readdir(directory), ['main.txt']);
});


test('基线读取边界：错任务、损坏内容与目录链接明确失败，不改写原文件', async () => {
  const { captureWorkspace } = require('../../src/main/services/workspace-results.ts');
  const { saveWorkspaceBaseline, readWorkspaceBaseline } = require('../../src/main/storage/results.ts');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-05/result-guards-'));
  const data = path.join(root, 'data'), project = path.join(root, 'project');
  await fs.mkdir(data); await fs.mkdir(project);
  const binding = { taskId: randomUUID(), operationId: randomUUID() };
  const snapshot = await captureWorkspace(project), git = { status: 'notRepository', message: '合成普通目录' };
  await saveWorkspaceBaseline(data, binding, snapshot, git);
  await assert.rejects(readWorkspaceBaseline(data, { ...binding, taskId: randomUUID() }), /归属不匹配/);
  await assert.rejects(saveWorkspaceBaseline(data, { ...binding, operationId: '../escape' }, snapshot, git), /无效/);
  const file = path.join(data, 'results', binding.operationId + '.baseline.json');
  const original = await fs.readFile(file, 'utf8');
  const damaged = JSON.parse(original); damaged.payload.snapshot.capturedAt = '2000-01-01T00:00:00.000Z';
  await fs.writeFile(file, JSON.stringify(damaged));
  await assert.rejects(readWorkspaceBaseline(data, binding), /校验失败/);
  await fs.writeFile(file, '{');
  await assert.rejects(readWorkspaceBaseline(data, binding), /未完整保存或已损坏/);
  const otherData = path.join(root, 'linked-data'), outside = path.join(root, 'outside');
  await fs.mkdir(otherData); await fs.mkdir(outside);
  await fs.symlink(outside, path.join(otherData, 'results'), 'junction');
  await assert.rejects(saveWorkspaceBaseline(otherData, binding, snapshot, git), /不是普通产品目录/);
  assert.deepEqual(await fs.readdir(outside), []);
});
