const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
require('ts-node').register({ transpileOnly: true });

async function project() {
  const base = path.resolve('.local-validation/m1-05'); await fs.mkdir(base, { recursive: true });
  return fs.mkdtemp(path.join(base, 'workspace-results-'));
}

test('noChanges 接缝：以实际文件建立基线，重复读取无变化且不写工作区', async () => {
  const { captureWorkspace, compareWorkspaceSnapshots } = require('../../src/main/services/workspace-results.ts');
  const root = await project();
  await fs.writeFile(path.join(root, 'main.cjs'), 'exports.value = 1;\n');
  const before = await captureWorkspace(root);
  assert.equal(before.files[0].path, 'main.cjs');
  assert.equal(before.files[0].text, 'exports.value = 1;\n');
  assert.deepEqual(await fs.readdir(root), ['main.cjs']);
  const result = compareWorkspaceSnapshots(before, await captureWorkspace(root));
  assert.equal(result.complete, true);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.issues, []);
});


test('changes 接缝：独立 shell 修改、未跟踪新增和删除均按基线核对，原人工内容不被改写', async () => {
  const { captureWorkspace, compareWorkspaceSnapshots } = require('../../src/main/services/workspace-results.ts');
  const { execFile } = require('node:child_process');
  const { promisify } = require('node:util');
  const root = await project();
  await fs.writeFile(path.join(root, 'main.cjs'), '人工已有修改\n');
  await fs.writeFile(path.join(root, 'remove.txt'), '待删除\n');
  await fs.writeFile(path.join(root, 'human-notes.txt'), '人工笔记保持逐字不变\n');
  const before = await captureWorkspace(root);
  await promisify(execFile)(process.execPath, ['-e', `const fs=require('node:fs');fs.writeFileSync('main.cjs','人工已有修改\\n追加修复\\n');fs.writeFileSync('added.txt','新产物');fs.unlinkSync('remove.txt');`], { cwd: root, windowsHide: true });
  const result = compareWorkspaceSnapshots(before, await captureWorkspace(root));
  assert.equal(result.complete, true);
  assert.deepEqual(result.changes.map(value => [value.path, value.operation]), [['added.txt', 'add'], ['main.cjs', 'update'], ['remove.txt', 'delete']]);
  assert.equal(result.changes.find(value => value.path === 'main.cjs').before.text, '人工已有修改\n');
  assert.equal(result.changes.find(value => value.path === 'main.cjs').after.text, '人工已有修改\n追加修复\n');
  assert.equal(await fs.readFile(path.join(root, 'human-notes.txt'), 'utf8'), '人工笔记保持逐字不变\n');
});

test('unreadableResult 接缝：链接和超限范围不伪装成无变化或删除，二进制不伪造文本', async () => {
  const { captureWorkspace, compareWorkspaceSnapshots, WORKSPACE_SCAN_LIMITS } = require('../../src/main/services/workspace-results.ts');
  const root = await project(), outside = await project();
  await fs.writeFile(path.join(outside, 'outside.txt'), '不可通过链接读取');
  await fs.writeFile(path.join(root, 'growing.txt'), '原有内容');
  const before = await captureWorkspace(root);
  await fs.symlink(outside, path.join(root, 'linked'), 'junction');
  await fs.writeFile(path.join(root, 'growing.txt'), Buffer.alloc(WORKSPACE_SCAN_LIMITS.fileBytes + 1));
  await fs.writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 255, 1]));
  const after = await captureWorkspace(root), result = compareWorkspaceSnapshots(before, after);
  assert.equal(result.complete, false);
  assert.ok(result.issues.some(value => value.path === 'linked' && value.reason === 'link'));
  assert.ok(result.issues.some(value => value.path === 'growing.txt' && value.reason === 'limit'));
  assert.equal(result.changes.some(value => value.path === 'growing.txt'), false);
  assert.equal(after.files.some(value => value.path.includes('outside.txt')), false);
  assert.equal(after.files.find(value => value.path === 'binary.bin').text, null);
  assert.equal(result.changes.find(value => value.path === 'binary.bin').operation, 'add');
  assert.equal(await fs.readFile(path.join(outside, 'outside.txt'), 'utf8'), '不可通过链接读取');
});


test('基线 Git 信息：记录既有人工改动和未跟踪文件，读取不刷新索引或执行项目 fsmonitor', async () => {
  const { captureGitState } = require('../../src/main/services/workspace-results.ts');
  const { promisify } = require('node:util');
  const exec = promisify(require('node:child_process').execFile);
  const root = await project();
  const git = args => exec('git', args, { cwd: root, windowsHide: true });
  await git(['init', '-q']);
  await fs.writeFile(path.join(root, 'tracked.cjs'), '原始版本\n');
  await git(['add', '--', 'tracked.cjs']);
  await git(['-c', 'user.name=合成测试', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=.git/no-hooks', 'commit', '-qm', '合成基线']);
  await fs.writeFile(path.join(root, 'tracked.cjs'), '人工已有修改\n');
  await fs.writeFile(path.join(root, 'untracked.txt'), '原有未跟踪文件');
  const hookRoot = await project(), marker = path.join(hookRoot, 'monitor-ran.txt'), hook = path.join(hookRoot, 'monitor.cjs');
  await fs.writeFile(hook, `require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran');`);
  await git(['config', 'core.fsmonitor', `${JSON.stringify(process.execPath)} ${JSON.stringify(hook)}`]);
  const index = await fs.readFile(path.join(root, '.git', 'index'));
  const state = await captureGitState(root);
  assert.equal(state.status, 'available');
  assert.deepEqual(state.changes.map(value => [value.path, value.index, value.worktree]), [['tracked.cjs', ' ', 'M'], ['untracked.txt', '?', '?']]);
  assert.deepEqual(await fs.readFile(path.join(root, '.git', 'index')), index);
  await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
});


test('读取失败保留根因：单个文件打开失败不报告删除，其他变化仍可核对', async t => {
  const { captureWorkspace, compareWorkspaceSnapshots } = require('../../src/main/services/workspace-results.ts');
  const root = await project(), file = path.join(root, 'locked.txt');
  await fs.writeFile(file, '原有内容');
  const before = await captureWorkspace(root);
  const open = fs.open;
  t.mock.method(fs, 'open', async (name, ...args) => {
    if (name === file) throw Object.assign(new Error('PRIVATE_ERROR_CONTENT'), { code: 'EACCES' });
    return open(name, ...args);
  });
  await fs.writeFile(path.join(root, 'new.txt'), '仍能检查的新文件');
  const result = compareWorkspaceSnapshots(before, await captureWorkspace(root));
  assert.equal(result.complete, false);
  assert.deepEqual(result.changes.map(value => value.path), ['new.txt']);
  assert.ok(result.issues.some(value => value.path === 'locked.txt' && value.code === 'EACCES'));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ERROR_CONTENT/);
});
