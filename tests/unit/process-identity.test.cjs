const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
require('ts-node').register({ transpileOnly: true });

test('身份查询临时诊断：超时仅附固定阶段，不暴露原始 stderr', async t => {
  const childProcess = require('node:child_process');
  t.mock.method(childProcess, 'execFile', (_file, _args, _options, callback) => {
    callback(Object.assign(new Error('private'), { killed: true, signal: 'SIGTERM' }), '', 'AXP:started:1788980000000\r\nprivate-token-value\r\nAXP:queried:1788980000100\r\n');
  });
  const { readProcessIdentity } = require('../../src/main/lifecycle/process-identity.ts');
  await assert.rejects(readProcessIdentity(1234), error => /阶段 queried/.test(error.message) && !error.message.includes('private'));
});

test('进程身份查询超时：保留超时与终止信号，不伪装不存在，也不输出敏感 stderr', async t => {
  const childProcess = require('node:child_process');
  t.mock.method(childProcess, 'execFile', (_file, _args, _options, callback) => {
    callback(Object.assign(new Error('synthetic-private-detail'), { killed: true, signal: 'SIGTERM' }), '', 'synthetic-private-stderr');
  });
  const { readProcessIdentity } = require('../../src/main/lifecycle/process-identity.ts');
  await assert.rejects(readProcessIdentity(1234), error => /超时/.test(error.message) && /SIGTERM/.test(error.message) && !/synthetic-private/.test(error.message));
});

test('进程身份：只读核验本测试子进程的 PID、创建时间和映像，退出后不把 PID 当存活证明', { timeout: 30000 }, async t => {
  const { readProcessIdentity, sameProcessIdentity } = require('../../src/main/lifecycle/process-identity.ts');
  const child = spawn(process.execPath, ['-e', "process.stdin.resume(); process.stdin.on('end',()=>process.exit(0));"], {
    windowsHide: true, shell: false, stdio: ['pipe', 'ignore', 'pipe'],
    env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR },
  });
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null) child.stdin.end(); await exited; });
  const identity = await readProcessIdentity(child.pid);
  assert.equal(identity.pid, child.pid);
  assert.equal(identity.parentPid, process.pid);
  assert.equal(path.normalize(identity.executablePath).toLowerCase(), path.normalize(process.execPath).toLowerCase());
  assert.ok(Number.isFinite(Date.parse(identity.createdAt)));
  assert.equal(sameProcessIdentity(identity, await readProcessIdentity(child.pid)), true);
  assert.equal(sameProcessIdentity({ ...identity, createdAt: '2000-01-01T00:00:00.0000000Z' }, identity), false);
  assert.equal(sameProcessIdentity({ ...identity, executablePath: 'C:\\unrelated.exe' }, identity), false);
  child.stdin.end(); await exited;
  assert.equal(await readProcessIdentity(child.pid), null);
  await assert.rejects(readProcessIdentity('1; Stop-Process'), /进程标识/);
});
