const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const lock = require('../runtime/codex.lock.json');

const root = path.resolve(__dirname, '..');

async function verify(filename, expected) {
  const stat = await fsp.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expected.bytes) throw new Error('固定 Codex 文件类型或大小不符，拒绝使用');
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  if (hash.digest('hex') !== expected.sha256) throw new Error('固定 Codex SHA-256 不符，拒绝使用');
}

async function exists(filename) {
  try { await fsp.lstat(filename); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function download(archive) {
  const response = await fetch(lock.archive.url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.body) throw new Error(`固定 Codex 下载失败（HTTP ${response.status}）`);
  const partial = `${archive}.part-${randomUUID()}`;
  const file = await fsp.open(partial, 'wx');
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > lock.archive.bytes) throw new Error('固定 Codex 下载超出锁定大小');
      await file.writeFile(chunk);
    }
  } finally { await file.close(); }
  await verify(partial, lock.archive);
  await fsp.rename(partial, archive);
}

async function prepareCodex({ cacheRoot = path.join(root, '.cache'), archivePath } = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('当前固定 Codex 资源只支持 Windows x64 构建');
  const directory = path.join(path.resolve(cacheRoot), 'engine', lock.version, 'win32-x64');
  const binary = path.join(directory, lock.binary.name);
  await fsp.mkdir(directory, { recursive: true });
  if (await exists(binary)) {
    // 损坏缓存是明确错误，不从 PATH 或其他版本静默替换。
    await verify(binary, lock.binary);
  } else {
    let archive = archivePath && path.resolve(archivePath);
    if (!archive) {
      archive = path.join(path.resolve(cacheRoot), 'codex-downloads', `${lock.version}.zip`);
      await fsp.mkdir(path.dirname(archive), { recursive: true });
      if (!await exists(archive)) await download(archive);
    }
    await verify(archive, lock.archive);
    const staging = path.join(path.resolve(cacheRoot), 'codex-downloads');
    await fsp.mkdir(staging, { recursive: true });
    const partial = path.join(staging, `${lock.binary.name}.part-${randomUUID()}`);
    const quote = value => `'${value.replaceAll("'", "''")}'`;
    // 只解出锁定条目，不将整个压缩包内容释放到工作目录。
    const command = `Add-Type -AssemblyName System.IO.Compression.FileSystem; $ErrorActionPreference='Stop'; $zip=[IO.Compression.ZipFile]::OpenRead(${quote(archive)}); try { $entry=$zip.GetEntry(${quote(lock.binary.name)}); if (!$entry) { throw '固定二进制条目缺失' }; [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,${quote(partial)}) } finally { $zip.Dispose() }`;
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 120000 });
    await verify(partial, lock.binary);
    await fsp.rename(partial, binary);
  }
  for (const name of ['LICENSE', 'NOTICE']) await fsp.copyFile(path.join(root, 'runtime', 'licenses', `codex-${name}`), path.join(directory, name));
  return directory;
}

module.exports = { prepareCodex };
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--archive')) throw new Error('用法：node scripts/prepare-codex.cjs [--archive 已下载的官方压缩包]');
  prepareCodex({ archivePath: args[1] }).then(directory => console.log(`固定 Codex 资源准备完成：${directory}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
