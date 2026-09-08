const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch } = require('./helpers.cjs');

test('执行模型交接：仅捕获已启用选中的 Flash，真实系统解密且不调用模型', { timeout: 45000 }, async t => {
  const { app } = await launch(); t.after(() => app.close());
  const result = await app.evaluate(async ({ app }, repository) => {
    const req = process.getBuiltinModule('node:module').createRequire(repository + '/package.json');
    req('ts-node').register({ transpileOnly: true, project: repository + '/tsconfig.json' });
    const { ModelService } = req(repository + '/src/main/services/models.ts');
    const service = new ModelService(app.getPath('userData'));
    const operationId = () => process.getBuiltinModule('node:crypto').randomUUID();
    let state = await service.saveKey({ operationId: operationId(), expectedRevision: 0, apiKey: 'synthetic-execution-key' });
    const original = globalThis.fetch; const requests = [];
    globalThis.fetch = async (url, options) => {
      requests.push({ url, method: options.method });
      return new Response(JSON.stringify({ data: [{ id: 'deepseek-v4-flash' }] }));
    };
    try { state = await service.fetchCatalog({ operationId: operationId(), expectedRevision: state.configRevision }); }
    finally { globalThis.fetch = original; }
    state = service.setSelection({ operationId: operationId(), expectedRevision: state.configRevision, selectedModelIds: ['deepseek-v4-flash'] });
    state = service.setActive({ operationId: operationId(), expectedRevision: state.configRevision, activeModelId: 'deepseek-v4-flash' });
    const snapshot = await service.captureExecution(state.configRevision);
    return { modelId: snapshot.modelId, revisionMatches: snapshot.configRevision === state.configRevision,
      keyMatches: snapshot.apiKey === 'synthetic-execution-key', immutable: Object.isFrozen(snapshot),
      settingsContainKey: JSON.stringify(service.read()).includes('synthetic-execution-key'), requests };
  }, path.resolve('.'));
  assert.equal(result.modelId, 'deepseek-v4-flash');
  assert.equal(result.revisionMatches, true); assert.equal(result.keyMatches, true);
  assert.equal(result.immutable, true); assert.equal(result.settingsContainKey, false);
  assert.deepEqual(result.requests, [{ url: 'https://api.deepseek.com/models', method: 'GET' }]);
});

test('执行模型交接：解密期间关闭连接拒绝旧快照，不把旧凭据交给执行', { timeout: 45000 }, async t => {
  const { app } = await launch(); t.after(() => app.close());
  const result = await app.evaluate(async ({ app, safeStorage }, repository) => {
    const req = process.getBuiltinModule('node:module').createRequire(repository + '/package.json');
    req('ts-node').register({ transpileOnly: true, project: repository + '/tsconfig.json' });
    const { ModelService } = req(repository + '/src/main/services/models.ts');
    const service = new ModelService(app.getPath('userData'));
    const operationId = () => process.getBuiltinModule('node:crypto').randomUUID();
    let state = await service.saveKey({ operationId: operationId(), expectedRevision: 0, apiKey: 'synthetic-race-key' });
    const fetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ id: 'deepseek-v4-flash' }] }));
    try { state = await service.fetchCatalog({ operationId: operationId(), expectedRevision: state.configRevision }); }
    finally { globalThis.fetch = fetch; }
    state = service.setSelection({ operationId: operationId(), expectedRevision: state.configRevision, selectedModelIds: ['deepseek-v4-flash'] });
    state = service.setActive({ operationId: operationId(), expectedRevision: state.configRevision, activeModelId: 'deepseek-v4-flash' });
    const original = safeStorage.decryptStringAsync;
    let release, entered;
    const gate = new Promise(resolve => { release = resolve; });
    const reached = new Promise(resolve => { entered = resolve; });
    safeStorage.decryptStringAsync = async (...args) => { entered(); await gate; return original.apply(safeStorage, args); };
    try {
      const pending = service.captureExecution(state.configRevision).then(() => ({ accepted: true }), error => ({ accepted: false, error: error.message }));
      await reached;
      service.setEnabled({ operationId: operationId(), expectedRevision: state.configRevision, enabled: false });
      release(); return await pending;
    } finally { release(); safeStorage.decryptStringAsync = original; }
  }, path.resolve('.'));
  assert.equal(result.accepted, false); assert.match(result.error, /配置已变化/);
  assert.doesNotMatch(result.error, /synthetic-race-key/);
});
