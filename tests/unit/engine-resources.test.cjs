const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { prepareCodex } = require('../../scripts/prepare-codex.cjs');
const lock = require('../../runtime/codex.lock.json');

async function temporaryCache() {
  const root = path.resolve('.local-validation/engine-assets');
  await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, 'test-'));
}

test('固定资源错误：损坏缓存不能触发下载或从 PATH 换版本', async t => {
  const cacheRoot = await temporaryCache();
  const directory = path.join(cacheRoot, 'engine', lock.version, 'win32-x64');
  await fs.mkdir(directory, { recursive: true });
  const binary = path.join(directory, lock.binary.name);
  await fs.writeFile(binary, '合成损坏文件');
  const fetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('不应下载'); };
  t.after(() => { globalThis.fetch = fetch; });
  await assert.rejects(prepareCodex({ cacheRoot }), /大小不符/);
  assert.equal(requests, 0);
  assert.equal(await fs.readFile(binary, 'utf8'), '合成损坏文件');
});

test('固定资源下载：不完整官方响应拒绝解压，失败临时文件不进入安装资源', async t => {
  const cacheRoot = await temporaryCache();
  const fetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async url => { requests.push(url); return new Response('合成不完整压缩包'); };
  t.after(() => { globalThis.fetch = fetch; });
  await assert.rejects(prepareCodex({ cacheRoot }), /大小不符/);
  assert.deepEqual(requests, [lock.archive.url]);
  assert.deepEqual(await fs.readdir(path.join(cacheRoot, 'engine', lock.version, 'win32-x64')), []);
});

test('固定资源完整性：大小正确但摘要错误的缓存仍拒绝使用且不联网替换', async t => {
  const cacheRoot = await temporaryCache();
  const directory = path.join(cacheRoot, 'engine', lock.version, 'win32-x64');
  await fs.mkdir(directory, { recursive: true });
  const binary = path.join(directory, lock.binary.name);
  const file = await fs.open(binary, 'wx');
  try { await file.truncate(lock.binary.bytes); } finally { await file.close(); }
  const fetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('不应下载'); };
  t.after(() => { globalThis.fetch = fetch; });
  await assert.rejects(prepareCodex({ cacheRoot }), /SHA-256 不符/);
  assert.equal(requests, 0);
  assert.equal((await fs.stat(binary)).size, lock.binary.bytes);
  assert.deepEqual(await fs.readdir(directory), [lock.binary.name]);
});
