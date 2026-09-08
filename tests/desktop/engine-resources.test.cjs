const { test } = require('node:test');
const assert = require('node:assert/strict');
const { launch } = require('./helpers.cjs');
const lock = require('../../runtime/codex.lock.json');

test('固定引擎资源：真实包携带指定二进制、许可证，校验通过后才运行版本命令', { timeout: 45000 }, async t => {
  const { app } = await launch();
  t.after(() => app.close());
  const result = await app.evaluate(async (_electron, lock) => {
    const fs = process.getBuiltinModule('node:fs');
    const path = process.getBuiltinModule('node:path');
    const crypto = process.getBuiltinModule('node:crypto');
    const directory = path.join(process.resourcesPath, 'engine', lock.version, 'win32-x64');
    const binary = path.join(directory, lock.binary.name);
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(binary)) hash.update(chunk);
    const digest = hash.digest('hex');
    if (digest !== lock.binary.sha256) throw new Error('固定引擎校验失败，不运行');
    const version = await new Promise((resolve, reject) => process.getBuiltinModule('node:child_process').execFile(binary, ['--version'],
      { windowsHide: true, timeout: 10000 }, (error, stdout) => error ? reject(error) : resolve(stdout.trim())));
    return { digest, version, bytes: fs.statSync(binary).size, outsideAsar: !binary.includes('app.asar'),
      license: fs.readFileSync(path.join(directory, 'LICENSE'), 'utf8').includes('Apache License'),
      notice: fs.readFileSync(path.join(directory, 'NOTICE'), 'utf8').includes('OpenAI Codex') };
  }, lock);
  assert.equal(result.digest, lock.binary.sha256);
  assert.equal(result.bytes, lock.binary.bytes);
  assert.match(result.version, /^codex-cli 0\.153\.4$/);
  assert.equal(result.outsideAsar, true);
  assert.equal(result.license, true);
  assert.equal(result.notice, true);
});
