const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const patch = {
  version: '7.11.2',
  original: '597ee2566eb360fb0332a19800161dabde82d04e218021bc82c2b6f59f185076',
  patched: 'f43c34df09fdafaef3591a255975cc1546b0528566f628e10e8bd995b4e16e20',
  before: "const bins = await (0, fast_glob_1.default)(node_path_1.default.join(buildPath, '**/.bin/**/*'));",
  after: "const bins = await (0, fast_glob_1.default)(fast_glob_1.default.convertPathToPattern(buildPath) + '/**/.bin/**/*');",
};
const hash = value => createHash('sha256').update(value).digest('hex');

function prepareBuildTools(directory = path.dirname(require.resolve('@electron-forge/core/package.json'))) {
  if (JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).version !== patch.version) throw new Error('Forge 版本变化，必须重新审查构建修正');
  const filename = path.join(directory, 'dist/api/package.js'), original = fs.readFileSync(filename);
  if (hash(original) === patch.patched) return '已核对';
  if (hash(original) !== patch.original) throw new Error('Forge 源码校验失败，不覆盖未知修改');
  const changed = Buffer.from(original.toString('utf8').replace(patch.before, patch.after));
  if (hash(changed) !== patch.patched) throw new Error('构建修正结果校验失败');
  fs.writeFileSync(filename, changed);
  if (hash(fs.readFileSync(filename)) !== patch.patched) throw new Error('构建修正落盘校验失败');
  return '已应用';
}

if (require.main === module) console.log(`Windows 构建路径修正：${prepareBuildTools()}`);
module.exports = { prepareBuildTools };
