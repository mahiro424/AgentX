const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fg = require('fast-glob');
const os = require('node:os');

test('Windows 打包：工具目录清理只遍历打包目录，不回到项目根目录', () => {
  const source = fs.readFileSync(require.resolve('@electron-forge/core/dist/api/package.js'), 'utf8');
  const argument = source.match(/const bins = await \(0, fast_glob_1.default\)\((.+)\);/)[1];
  const buildPath = 'C:/Temp/package-sample';
  const pattern = new Function('node_path_1', 'fast_glob_1', 'buildPath', `return ${argument}`)({ default: path.win32 }, { default: fg }, buildPath);
  const [task] = fg.generateTasks(pattern);
  assert.equal(task.base, buildPath);
  assert.notEqual(task.base, '.');
});

test('构建修正：重复执行幂等；版本或文件漂移阻断，不覆盖未知修改', () => {
  const { prepareBuildTools } = require('../../scripts/prepare-build-tools.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentx-build-patch-'));
  fs.mkdirSync(path.join(root, 'dist/api'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '7.11.2' }));
  const target = path.join(root, 'dist/api/package.js');
  const installed = fs.readFileSync(require.resolve('@electron-forge/core/dist/api/package.js'), 'utf8');
  const original = installed.replace("fast_glob_1.default.convertPathToPattern(buildPath) + '/**/.bin/**/*'", "node_path_1.default.join(buildPath, '**/.bin/**/*')");
  fs.writeFileSync(target, original);
  assert.equal(prepareBuildTools(root), '已应用');
  assert.equal(prepareBuildTools(root), '已核对');
  fs.appendFileSync(target, '\n// 合成未知修改\n');
  const changed = fs.readFileSync(target);
  assert.throws(() => prepareBuildTools(root), /源码校验失败/);
  assert.deepEqual(fs.readFileSync(target), changed);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '99.0.0' }));
  assert.throws(() => prepareBuildTools(root), /版本变化/);
  assert.deepEqual(fs.readFileSync(target), changed);
});
