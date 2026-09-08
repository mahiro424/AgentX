const { test } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
require('ts-node').register({ transpileOnly: true });
const lock = require('../../runtime/codex.lock.json');

test('固定进程：损坏安装资源在创建子进程之前被拒绝，不从 PATH 替换', async t => {
  const { openCodex } = require('../../src/main/runtime/codex/process.ts');
  const childProcess = require('node:child_process');
  const launch = t.mock.method(childProcess, 'spawn', () => { throw new Error('不应启动'); });
  const base = path.resolve('.local-validation/m1-04'); await fsp.mkdir(base, { recursive: true });
  const home = await fsp.mkdtemp(path.join(base, 'invalid-resource-'));
  const directory = path.join(home, 'engine', lock.version, 'win32-x64'); await fsp.mkdir(directory, { recursive: true });
  const binary = path.join(directory, lock.binary.name); await fsp.writeFile(binary, 'synthetic-invalid');
  await assert.rejects(openCodex({ resourcesDirectory: home, engineHome: home, workingDirectory: home, environment: {} },
    { notification: () => {}, request: () => {}, disconnected: () => {} }), /固定引擎资源无效/);
  assert.equal(launch.mock.callCount(), 0);
  assert.equal(await fsp.readFile(binary, 'utf8'), 'synthetic-invalid');
});

test('固定握手：错误目录或平台不发送 initialized，并使连接不可继续执行', async () => {
  const { PassThrough } = require('node:stream');
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const { initializeCodex } = require('../../src/main/runtime/codex/initialize.ts');
  const base = path.resolve('.local-validation/m1-04'); await fsp.mkdir(base, { recursive: true });
  const home = await fsp.mkdtemp(path.join(base, 'handshake-contract-'));
  for (const wrong of [{ codexHome: path.join(home, 'different') }, { platformOs: 'linux' }, { userAgent: null }]) {
    const input = new PassThrough(), output = new PassThrough(), sent = [];
    input.setEncoding('utf8'); input.on('data', text => {
      const message = JSON.parse(text); sent.push(message);
      output.write(JSON.stringify({ id: message.id, result: { userAgent: 'synthetic', codexHome: home, platformFamily: 'windows', platformOs: 'windows', ...wrong } }) + '\n');
    });
    const transport = new CodexTransport(input, output, { notification: () => {}, request: () => {}, disconnected: () => {} });
    try {
      await assert.rejects(initializeCodex(transport, home), /不同的数据目录|不兼容/);
      await assert.rejects(transport.call('turn/start', {}), /关闭/);
      assert.deepEqual(sent.map(message => message.method), ['initialize']);
      assert.equal(sent[0].params.capabilities.experimentalApi, true);
    } finally { transport.close(); input.destroy(); output.destroy(); }
  }
});

test('固定进程：生产配置被真实引擎读取，Flash 目录可用且 shell 不继承凭据', { timeout: 45000 }, async t => {
  const { openExecutionCodex: openCodex } = require('../../src/main/runtime/codex/process.ts');
  const { prepareCodexConfiguration } = require('../../src/main/runtime/codex/configuration.ts');
  const base = path.resolve('.local-validation/m1-04'); await fsp.mkdir(base, { recursive: true });
  const root = await fsp.mkdtemp(path.join(base, 'prepared-process-'));
  const prepared = await prepareCodexConfiguration(root, { modelId: 'deepseek-v4-flash', apiKey: 'synthetic-prepared-key' });
  const network = [];
  const trap = http.createServer((request, response) => { network.push(request.url); request.resume(); response.writeHead(503); response.end(); });
  trap.on('connect', (request, socket) => { network.push(request.url); socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n'); });
  await new Promise(resolve => trap.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => trap.close(resolve)));
  const proxy = `http://127.0.0.1:${trap.address().port}`;
  Object.assign(prepared.environment, { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy, NO_PROXY: '' });
  const runtime = await openCodex({ ...prepared, resourcesDirectory: path.join(process.env.AGENTX_TEST_PACKAGE_DIR ?? path.resolve('out/AgentX-win32-x64'), 'resources'), workingDirectory: root },
    { notification: () => {}, request: () => { throw new Error('不得请求审批'); }, disconnected: () => {} });
  t.after(() => runtime.close());
  assert.equal(runtime.identity?.pid, runtime.pid);
  assert.equal(runtime.identity?.parentPid, process.pid);
  assert.equal(runtime.identity?.executablePath.toLowerCase(), runtime.binary?.toLowerCase());
  const { config } = await runtime.transport.call('config/read', { cwd: root, includeLayers: true });
  assert.equal(config.model, 'deepseek-v4-flash');
  assert.equal(config.model_providers.deepseek.base_url, 'https://api.deepseek.com');
  assert.equal(config.model_providers.deepseek.env_key, 'AGENTX_API_KEY');
  assert.equal(config.shell_environment_policy.inherit, 'none');
  assert.equal(config.shell_environment_policy.set.AGENTX_API_KEY, undefined);
  assert.equal(config.windows.sandbox, 'unelevated');
  const { verifyExecutionConfiguration } = require('../../src/main/runtime/codex/configuration.ts');
  await verifyExecutionConfiguration(runtime.transport, root);
  const models = await runtime.transport.call('model/list', {});
  assert.deepEqual(models.data.map(model => model.model), ['deepseek-v4-flash']);
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn, children = [];
  t.mock.method(childProcess, 'spawn', (...args) => { const child = originalSpawn(...args); children.push(child); return child; });
  await assert.rejects(openCodex({ ...prepared,
    overrides: [...prepared.overrides, 'model_providers.deepseek.base_url="https://synthetic.invalid"'],
    resourcesDirectory: path.join(process.env.AGENTX_TEST_PACKAGE_DIR ?? path.resolve('out/AgentX-win32-x64'), 'resources'), workingDirectory: root },
  { notification() {}, request() { throw new Error('不得请求审批'); }, disconnected() {} }), /配置不符/);
  assert.equal(children.length, 1);
  assert.throws(() => process.kill(children[0].pid, 0), error => error.code === 'ESRCH');
  assert.deepEqual(network, []);
});

test('固定 Codex stdio：真实子进程握手与配置读取，隔离目录且不调用模型', { timeout: 45000 }, async t => {
  const { openCodex } = require('../../src/main/runtime/codex/process.ts');
  const base = path.resolve('.local-validation/m1-04'); await fsp.mkdir(base, { recursive: true });
  const home = await fsp.mkdtemp(path.join(base, 'handshake-'));
  const resourcesDirectory = path.join(process.env.AGENTX_TEST_PACKAGE_DIR ?? path.resolve('out/AgentX-win32-x64'), 'resources');
  const network = [];
  const trap = http.createServer((request, response) => { network.push(request.url); request.resume(); response.writeHead(503); response.end(); });
  await new Promise(resolve => trap.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => trap.close(resolve)));
  const address = `http://127.0.0.1:${trap.address().port}`;
  await fsp.writeFile(path.join(home, 'config.toml'), `model="deepseek-v4-flash"\nmodel_provider="deepseek"\ncheck_for_update_on_startup=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[features]\nplugins=false\n[model_providers.deepseek]\nname="DeepSeek"\nbase_url="${address}/v1"\nwire_api="responses"\nenv_key="AGENTX_TEST_ONLY_KEY"\nrequires_openai_auth=false\n`, 'utf8');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|WINDIR|TEMP|TMP|PATH|PATHEXT|COMSPEC|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(key)));
  Object.assign(env, { CODEX_HOME: home, AGENTX_TEST_ONLY_KEY: 'synthetic-not-a-real-key', HTTP_PROXY: address, HTTPS_PROXY: address, ALL_PROXY: address, NO_PROXY: '127.0.0.1,localhost' });
  const runtime = await openCodex({ resourcesDirectory, engineHome: home, workingDirectory: home, environment: env },
    { notification: () => {}, request: () => { throw new Error('握手不应请求审批'); }, disconnected: () => {} });
  t.after(() => runtime.close());
  const { hello, transport } = runtime;
  assert.equal(path.normalize(hello.codexHome).toLowerCase(), home.toLowerCase());
  assert.equal(hello.platformOs, 'windows');
  const config = await transport.call('config/read', { cwd: home, includeLayers: true });
  assert.equal(config.config.model, 'deepseek-v4-flash');
  assert.equal(config.config.model_provider, 'deepseek');
  assert.equal(config.config.approval_policy, 'on-request');
  assert.equal(config.config.sandbox_mode, 'workspace-write');
  assert.deepEqual(network, []);
  await runtime.close();
  assert.throws(() => process.kill(runtime.pid, 0), error => error.code === 'ESRCH');
});
