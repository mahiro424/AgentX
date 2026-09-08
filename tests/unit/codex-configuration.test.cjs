const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
require('ts-node').register({ transpileOnly: true });

test('生效配置：拒绝非 Flash、错误地址和 shell 凭据继承，不回显敏感内容', async () => {
  const { verifyExecutionConfiguration } = require('../../src/main/runtime/codex/configuration.ts');
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const { PassThrough } = require('node:stream');
  const valid = { model: 'deepseek-v4-flash', model_provider: 'deepseek', approval_policy: 'on-request', sandbox_mode: 'workspace-write',
    model_providers: { deepseek: { base_url: 'https://api.deepseek.com', wire_api: 'responses', env_key: 'AGENTX_API_KEY', requires_openai_auth: false } },
    sandbox_workspace_write: { network_access: false }, windows: { sandbox: 'unelevated' }, shell_environment_policy: { inherit: 'none', set: {} } };
  for (const config of [
    { ...valid, model: 'other-model' }, { ...valid, approval_policy: 'never' },
    { ...valid, model_providers: { deepseek: { ...valid.model_providers.deepseek, base_url: 'https://synthetic.invalid/secret-value' } } },
    { ...valid, shell_environment_policy: { inherit: 'all', set: {} } },
    { ...valid, shell_environment_policy: { inherit: 'none', set: { AGENTX_API_KEY: 'secret-value' } } },
  ]) {
    const input = new PassThrough(), output = new PassThrough(), sent = [];
    input.on('data', bytes => { const request = JSON.parse(bytes.toString()); sent.push(request); output.write(JSON.stringify({ id: request.id, result: { config } }) + '\n'); });
    const transport = new CodexTransport(input, output, { notification() {}, request() {}, disconnected() {} });
    try {
      await assert.rejects(verifyExecutionConfiguration(transport, path.resolve('.local-validation/m1-04')), error => {
        assert.match(error.message, /未发送任务/); assert.doesNotMatch(error.message, /secret-value/); return true;
      });
      assert.deepEqual(sent.map(request => request.method), ['config/read']);
      assert.equal(sent[0].params.includeLayers, true);
    } finally { transport.close(); input.destroy(); output.destroy(); }
  }
});

test('引擎配置：密钥只进入专属进程环境，shell 白名单和落盘目录均不含密钥', async () => {
  const { prepareCodexConfiguration } = require('../../src/main/runtime/codex/configuration.ts');
  const base = path.resolve('.local-validation/m1-04'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'configuration-'));
  const value = await prepareCodexConfiguration(root, { modelId: 'deepseek-v4-flash', apiKey: 'synthetic-engine-key' },
    { SystemRoot: 'C:\\Windows', PATH: 'C:\\Windows\\System32', OPENAI_API_KEY: 'other-private-key', CODEX_HOME: 'C:\\Wrong', EXTRA_SECRET: 'private' });
  assert.equal(value.environment.AGENTX_API_KEY, 'synthetic-engine-key');
  assert.equal(value.environment.OPENAI_API_KEY, undefined); assert.equal(value.environment.CODEX_HOME, undefined);
  assert.equal(value.environment.EXTRA_SECRET, undefined);
  assert.equal(JSON.stringify(value.overrides).includes('synthetic-engine-key'), false);
  const policy = value.overrides.find(line => line.startsWith('shell_environment_policy='));
  assert.match(policy, /inherit="none"/); assert.doesNotMatch(policy, /API_KEY|SECRET/);
  const models = await fs.readFile(path.join(value.engineHome, 'models.json'), 'utf8');
  assert.equal(models.includes('synthetic-engine-key'), false);
  assert.deepEqual(JSON.parse(models).models.map(model => model.slug), ['deepseek-v4-flash']);
  assert.equal(value.overrides.includes('model_providers.deepseek.base_url="https://api.deepseek.com"'), true);
});

test('引擎配置：其他模型在落盘前拒绝，已有不同目录不被覆盖', async () => {
  const { prepareCodexConfiguration } = require('../../src/main/runtime/codex/configuration.ts');
  const base = path.resolve('.local-validation/m1-04'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'configuration-guard-'));
  await assert.rejects(prepareCodexConfiguration(root, { modelId: 'not-flash', apiKey: 'synthetic-key' }, {}), /只支持 Flash/);
  assert.deepEqual(await fs.readdir(root), []);
  const directory = path.join(root, 'engine', 'codex'); await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'models.json'); await fs.writeFile(file, '保留原有内容');
  await assert.rejects(prepareCodexConfiguration(root, { modelId: 'deepseek-v4-flash', apiKey: 'synthetic-key' }, {}), /未覆盖/);
  assert.equal(await fs.readFile(file, 'utf8'), '保留原有内容');
});


test('历史配置：无需模型凭据，环境不继承任何 Key，固定本地不可执行连接', async () => {
  const { prepareCodexHistoryConfiguration } = require('../../src/main/runtime/codex/configuration.ts');
  const base = path.resolve('.local-validation/m1-05'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'history-config-'));
  const prepared = await prepareCodexHistoryConfiguration(root, { PATH: 'C:\\Windows', AGENTX_API_KEY: 'private-key', OPENAI_API_KEY: 'private-key' });
  assert.deepEqual(Object.keys(prepared.environment), ['PATH']);
  assert.ok(prepared.overrides.includes('model_providers.deepseek.base_url="http://127.0.0.1:9"'));
  assert.doesNotMatch(JSON.stringify(prepared), /private-key/);
});
