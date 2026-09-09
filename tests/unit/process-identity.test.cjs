const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
require('ts-node').register({ transpileOnly: true });

test('进程身份只读查询：不依赖额外 JSON 命令模块，仍核验真实进程完整身份', { timeout: 15000 }, async t => {
  const childProcess = require('node:child_process'), original = childProcess.execFile;
  t.mock.method(childProcess, 'execFile', (file, args, options, callback) => {
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    const prefix = `Import-Module "$PSHOME/Modules/CimCmdlets/CimCmdlets.psd1" -ErrorAction Stop; Remove-Module Microsoft.PowerShell.Utility -ErrorAction SilentlyContinue; $PSModuleAutoLoadingPreference='None'; `;
    return original(file, [...args.slice(0, -1), Buffer.from(prefix + script, 'utf16le').toString('base64')], options, callback);
  });
  const { readProcessIdentity } = require('../../src/main/lifecycle/process-identity.ts');
  const actual = await readProcessIdentity(process.pid);
  assert.equal(actual.pid, process.pid);
  assert.equal(actual.parentPid, process.ppid);
  assert.equal(path.normalize(actual.executablePath).toLowerCase(), path.normalize(process.execPath).toLowerCase());
});

test('进程身份查询超时：保留超时与终止信号，不伪装不存在，也不输出敏感 stderr', async t => {
  const childProcess = require('node:child_process');
  t.mock.method(childProcess, 'execFile', (_file, _args, _options, callback) => {
    callback(Object.assign(new Error('synthetic-private-detail'), { killed: true, signal: 'SIGTERM' }), '', 'synthetic-private-stderr');
  });
  const { readProcessIdentity } = require('../../src/main/lifecycle/process-identity.ts');
  await assert.rejects(readProcessIdentity(1234), error => /超时/.test(error.message) && /SIGTERM/.test(error.message) && !/synthetic-private/.test(error.message));
});

test('进程身份输出：完整保留中文路径和创建时间精度，只接受完整标量帧', async t => {
  const childProcess = require('node:child_process');
  const identity = { pid: 1234, parentPid: 12, createdAt: '2026-09-10T00:01:02.1234567Z', executablePath: 'C:\\中文 + 空格\\应用.exe' };
  const encoded = Buffer.from(identity.executablePath).toString('base64');
  const frame = `AXPI1\t1234\t12\t${identity.createdAt}\t${encoded}`;
  let output = frame + '\r\n';
  t.mock.method(childProcess, 'execFile', (_file, _args, options, callback) => {
    assert.equal(options.timeout, 10000); assert.equal(options.maxBuffer, 65536);
    assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
    callback(null, output, 'synthetic-private-stderr');
  });
  const { readProcessIdentity } = require('../../src/main/lifecycle/process-identity.ts');
  assert.deepEqual(await readProcessIdentity(1234), identity);
  for (const invalid of ['', '{}', 'null\n' + frame, frame + '\textra', frame.replace('AXPI1', 'AXPI2'),
    frame.replace('\t1234\t', '\t1235\t'), frame.replace('\t1234\t', '\t+1234\t'), frame.replace('\t12\t', '\t4294967296\t'),
    frame.replace(encoded, encoded + '!'), frame.replace(encoded, Buffer.from([0xc3, 0x28]).toString('base64')),
    frame.replace(encoded, Buffer.from('relative.exe').toString('base64')), frame.replace(encoded, Buffer.from('\ufeffC:\\fake.exe').toString('base64'))]) {
    output = invalid;
    await assert.rejects(readProcessIdentity(1234), error => /进程身份/.test(error.message) && !error.message.includes('synthetic-private'));
  }
  output = 'null\r\n'; assert.equal(await readProcessIdentity(1234), null);
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
