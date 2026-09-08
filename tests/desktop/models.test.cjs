const { test } = require('node:test');
const assert = require('node:assert/strict');
const { launch, crashTestApp } = require('./helpers.cjs');

test('unconfigured：模型设置解释 Key 配置，返回保留草稿且不要求登录', { timeout: 45000 }, async t => {
  const { app, page } = await launch();
  t.after(() => app.close());
  await page.getByRole('textbox', { name: '任务要求' }).fill('先保留我的目标');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '模型连接', exact: true }).click();
  await page.getByRole('heading', { name: '模型连接', exact: true }).waitFor();
  await page.getByText('粘贴新密钥后，离开输入框或按 Enter 保存。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '拉取模型', exact: true }).isDisabled(), true);
  const state = await page.evaluate(() => window.agentx.getModelSettings());
  assert.equal(state.hasCredential, false);
  assert.deepEqual(state.selectedModelIds, []);
  assert.equal(await page.getByRole('button', { name: /登录|注册|移除|更换密钥/ }).count(), 0);
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: '任务要求' }).inputValue(), '先保留我的目标');
});

test('editing / saved / masked：完整值 Enter 保存系统密文，空编辑不覆盖，重开保留配置', { timeout: 90000 }, async t => {
  let current = await launch();
  t.after(() => current.app.close());
  const open = async () => {
    await current.page.getByRole('button', { name: '设置', exact: true }).click();
    await current.page.getByRole('button', { name: '模型连接', exact: true }).click();
  };
  await open();
  const key = current.page.getByLabel('API Key', { exact: true });
  await key.fill('synthetic-key-m1-save-only');
  assert.equal((await current.page.evaluate(() => window.agentx.getModelSettings())).hasCredential, false);
  await key.press('Enter');
  await current.page.getByRole('status').filter({ hasText: '密钥已保存' }).waitFor();
  assert.equal(await key.inputValue(), '');
  const saved = await current.page.evaluate(() => window.agentx.getModelSettings());
  assert.equal(saved.hasCredential, true);
  assert.equal(saved.configRevision, 1);
  assert.equal(JSON.stringify(saved).includes('synthetic-key'), false);
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const config = await fs.readFile(path.join(current.data, 'config.json'), 'utf8');
  const encrypted = await fs.readFile(path.join(current.data, 'secrets.enc'), 'utf8');
  assert.equal(config.includes('synthetic-key'), false);
  assert.equal(encrypted.includes('synthetic-key'), false);
  await key.fill('');
  await key.press('Enter');
  assert.equal((await current.page.evaluate(() => window.agentx.getModelSettings())).configRevision, 1);
  const data = current.data;
  await current.app.close();
  current = await launch(data);
  await open();
  assert.equal((await current.page.evaluate(() => window.agentx.getModelSettings())).hasCredential, true);
  assert.equal(await current.page.getByLabel('API Key', { exact: true }).inputValue(), '');
  assert.equal(await current.page.getByLabel('API Key', { exact: true }).getAttribute('type'), 'password');
});

test('revealed：只有显式点击临时解密，关闭、离页和窗口失焦清除明文', { timeout: 45000 }, async t => {
  const { app, page } = await launch();
  t.after(() => app.close());
  await page.evaluate(() => window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: 0, apiKey: 'synthetic-reveal-only' }));
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '模型连接', exact: true }).click();
  const key = page.getByLabel('API Key', { exact: true });
  assert.equal(await key.inputValue(), '');
  await page.getByRole('button', { name: '显示 API Key', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#model-api-key')?.value === 'synthetic-reveal-only');
  assert.equal(await key.getAttribute('type'), 'text');
  await page.getByRole('button', { name: '隐藏 API Key', exact: true }).click();
  assert.equal(await key.inputValue(), '');
  await page.getByRole('button', { name: '显示 API Key', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#model-api-key')?.type === 'text');
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  assert.equal(await page.getByLabel('API Key', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  assert.equal(await key.inputValue(), '');
  await page.getByRole('button', { name: '显示 API Key', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#model-api-key')?.type === 'text');
  // Playwright 默认模拟页面始终有焦点；此处关闭模拟，再验证真实 OS 失焦。
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await app.evaluate(({ BrowserWindow }) => new Promise((resolve, reject) => { const window = BrowserWindow.getAllWindows()[0]; const timer = setTimeout(() => reject(new Error('未收到原生窗口失焦')), 5000); const done = () => { clearTimeout(timer); resolve(); }; window.once('blur', done); window.hide(); if (!window.isFocused()) { window.removeListener('blur', done); done(); } }));
  await page.waitForFunction(() => !document.hasFocus());
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()), false);
  await page.waitForFunction(() => document.querySelector('#model-api-key')?.value === '');
  assert.equal(await key.getAttribute('type'), 'password');
});

test('disabledConnection：连接关闭保留密钥，重新启用不要求重新填写', { timeout: 45000 }, async t => {
  const { app, page } = await launch();
  t.after(() => app.close());
  await page.evaluate(() => window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: 0, apiKey: 'synthetic-disabled-key' }));
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '模型连接', exact: true }).click();
  const enabled = page.getByRole('switch', { name: '启用 DeepSeek' });
  await enabled.click();
  await page.waitForFunction(async () => !(await window.agentx.getModelSettings()).enabled);
  assert.equal((await page.evaluate(() => window.agentx.getModelSettings())).hasCredential, true);
  await page.getByText('连接已关闭，密钥与模型选择已保留，新轮不可使用此连接。', { exact: true }).waitFor();
  await enabled.click();
  await page.waitForFunction(async () => (await window.agentx.getModelSettings()).enabled);
  assert.equal((await page.evaluate(() => window.agentx.getModelSettings())).hasCredential, true);
});

test('fetching / catalogLoaded：点击拉取才请求固定地址，显示真实候选且不自动勾选', { timeout: 45000 }, async t => {
  const { app, page } = await launch();
  t.after(() => app.close());
  await app.evaluate(() => {
    globalThis.modelRequests = [];
    globalThis.fetch = async (url, options) => {
      globalThis.modelRequests.push({ url, method: options.method, authorized: options.headers.Authorization === 'Bearer synthetic-fetch-key', redirect: options.redirect });
      return new Promise(resolve => { globalThis.finishModels = () => resolve(new Response(JSON.stringify({ data: [{ id: 'deepseek-v4-flash' }, { id: 'synthetic-extra-model' }] }), { status: 200 })); });
    };
  });
  await page.evaluate(() => window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: 0, apiKey: 'synthetic-fetch-key' }));
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '模型连接', exact: true }).click();
  assert.equal(await app.evaluate(() => globalThis.modelRequests.length), 0);
  await page.getByRole('button', { name: '拉取模型', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '正在拉取模型' }).waitFor();
  assert.deepEqual(await app.evaluate(() => globalThis.modelRequests), [{ url: 'https://api.deepseek.com/models', method: 'GET', authorized: true, redirect: 'error' }]);
  await app.evaluate(() => globalThis.finishModels());
  await page.getByText('deepseek-v4-flash', { exact: true }).waitFor();
  const state = await page.evaluate(() => window.agentx.getModelSettings());
  assert.deepEqual(state.catalog.modelIds, ['deepseek-v4-flash', 'synthetic-extra-model']);
  assert.deepEqual(state.selectedModelIds, []);
  assert.ok(state.catalog.fetchedAt);
  assert.equal(await page.getByRole('checkbox', { name: '选择 deepseek-v4-flash' }).isChecked(), false);
});

test('noSelection / unsupported：只把启用连接下勾选的候选带到工作台，其他模型明确禁用', { timeout: 45000 }, async t => {
  const { app, page } = await launch();
  t.after(() => app.close());
  await app.evaluate(() => { globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ id: 'deepseek-v4-flash' }, { id: 'synthetic-unopened' }] }), { status: 200 }); });
  await page.evaluate(async () => {
    const saved = await window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: 0, apiKey: 'synthetic-selection-key' });
    await window.agentx.fetchModelCatalog({ operationId: crypto.randomUUID(), expectedRevision: saved.configRevision });
  });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '模型连接', exact: true }).click();
  await page.getByRole('checkbox', { name: '选择 deepseek-v4-flash' }).click();
  await page.waitForFunction(() => document.querySelector('input[aria-label="选择 deepseek-v4-flash"]')?.checked === true);
  await page.getByRole('checkbox', { name: '选择 synthetic-unopened' }).click();
  await page.waitForFunction(() => document.querySelector('input[aria-label="选择 synthetic-unopened"]')?.checked === true);
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  const picker = page.getByRole('combobox', { name: '模型' });
  await picker.waitFor();
  assert.deepEqual(await picker.locator('option').allTextContents(), ['选择模型', 'deepseek-v4-flash · 未测试', 'synthetic-unopened · 本阶段未开放']);
  assert.equal(await picker.locator('option[value="synthetic-unopened"]').isDisabled(), true);
  await picker.selectOption('deepseek-v4-flash');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('checkbox', { name: '选择 deepseek-v4-flash' }).click();
  await page.waitForFunction(() => document.querySelector('input[aria-label="选择 deepseek-v4-flash"]')?.checked === false);
  await page.getByRole('checkbox', { name: '选择 synthetic-unopened' }).click();
  await page.waitForFunction(() => document.querySelector('input[aria-label="选择 synthetic-unopened"]')?.checked === false);
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await page.getByText('未选择可用模型', { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.agentx.getModelSettings())).activeModelId, null);
  assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);
});

test('catalogEmpty / selectedMissing：远端空列表明确显示，原勾选保留失效标记且不能选择执行', { timeout: 45000 }, async t => {
  const { app, page } = await launch();
  t.after(() => app.close());
  await app.evaluate(() => { globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ id: 'deepseek-v4-flash' }] }), { status: 200 }); });
  await page.evaluate(async () => {
    let state = await window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: 0, apiKey: 'synthetic-missing-model' });
    state = await window.agentx.fetchModelCatalog({ operationId: crypto.randomUUID(), expectedRevision: state.configRevision });
    await window.agentx.setSelectedModels({ operationId: crypto.randomUUID(), expectedRevision: state.configRevision, selectedModelIds: ['deepseek-v4-flash'] });
  });
  await app.evaluate(() => { globalThis.fetch = async () => new Response(JSON.stringify({ data: [] }), { status: 200 }); });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '模型连接', exact: true }).click();
  await page.getByRole('button', { name: '拉取模型', exact: true }).click();
  await page.getByText('服务返回空模型列表。', { exact: true }).waitFor();
  await page.getByText('已失效：本次列表未返回此模型', { exact: true }).waitFor();
  assert.equal(await page.getByRole('checkbox', { name: '选择 deepseek-v4-flash' }).isChecked(), true);
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: '模型' }).locator('option[value="deepseek-v4-flash"]').isDisabled(), true);
  const state = await page.evaluate(() => window.agentx.getModelSettings());
  await assert.rejects(page.evaluate(revision => window.agentx.setActiveModel({ operationId: crypto.randomUUID(), expectedRevision: revision, activeModelId: 'deepseek-v4-flash' }), state.configRevision), /当前模型不可选择/);
});

test('saving / saveFailed：系统加密失败保留输入和旧凭据，后续请求不能偷用旧 Key', { timeout: 45000 }, async t => {
  const { app, page, data } = await launch();
  t.after(() => app.close());
  await page.evaluate(() => window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: 0, apiKey: 'synthetic-old-key' }));
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const before = await fs.readFile(path.join(data, 'config.json'), 'utf8');
  await app.evaluate(({ safeStorage }) => {
    globalThis.fixtureEncrypt = safeStorage.encryptStringAsync;
    globalThis.fixtureEncryptionCount = 0;
    safeStorage.encryptStringAsync = () => new Promise((_, reject) => { globalThis.fixtureEncryptionCount++; globalThis.failEncryption = () => { setImmediate(() => { globalThis.fixtureRejectRan = true; reject(new Error('合成加密故障，不能外泄输入')); }); }; });
    globalThis.fixtureNetworkCount = 0;
    globalThis.fetch = async () => { globalThis.fixtureNetworkCount++; return new Response(JSON.stringify({ data: [] }), { status: 200 }); };
  });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '模型连接', exact: true }).click();
  const key = page.getByLabel('API Key', { exact: true });
  await key.fill('synthetic-new-key');
  await key.press('Enter');
  await page.getByRole('status').filter({ hasText: '正在加密保存密钥' }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.fixtureNetworkCount), 0);
  await app.evaluate(() => globalThis.failEncryption());
  assert.equal(await app.evaluate(() => globalThis.fixtureRejectRan), true);
  await page.waitForFunction(async () => Boolean((await window.agentx.getModelSettings()).keySaveError));
  await page.getByRole('alert').filter({ hasText: '系统凭据加密不可用' }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.fixtureEncryptionCount), 1);
  assert.equal(await key.inputValue(), 'synthetic-new-key');
  assert.equal(await fs.readFile(path.join(data, 'config.json'), 'utf8'), before);
  assert.equal((await page.evaluate(() => window.agentx.getModelSettings())).hasCredential, true);
  await assert.rejects(page.evaluate(() => window.agentx.fetchModelCatalog({ operationId: crypto.randomUUID(), expectedRevision: 1 })), /上次密钥保存失败/);
  assert.equal(await app.evaluate(() => globalThis.fixtureNetworkCount), 0);
  await app.evaluate(({ safeStorage }) => { safeStorage.encryptStringAsync = globalThis.fixtureEncrypt; });
});


test('testing / testPassed：只有手动点 Flash 行才发最小推理请求，结果持久化且不修改勾选', { timeout: 45000 }, async t => {
  const { app, page, data } = await launch();
  t.after(() => app.close());
  await app.evaluate(() => {
    globalThis.fixtureRequests = [];
    globalThis.fetch = async (url, init) => {
      if (init.method === 'GET') return new Response(JSON.stringify({ data: [{ id: 'deepseek-v4-flash' }, { id: 'synthetic-other' }] }), { status: 200 });
      globalThis.fixtureRequests.push({ url, body: JSON.parse(init.body), redirect: init.redirect });
      return new Promise(resolve => { globalThis.finishModelTest = () => resolve(new Response(JSON.stringify({ id: 'synthetic-response', object: 'response', status: 'completed', model: 'deepseek-v4-flash', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'OK' }] }] }), { status: 200 })); });
    };
  });
  await page.evaluate(async () => {
    const state = await window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: 0, apiKey: 'synthetic-test-key' });
    await window.agentx.fetchModelCatalog({ operationId: crypto.randomUUID(), expectedRevision: state.configRevision });
  });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '模型连接', exact: true }).click();
  const trigger = page.getByRole('button', { name: '测试连接 deepseek-v4-flash', exact: true });
  await trigger.click();
  await page.getByText('测试中…', { exact: true }).waitFor();
  assert.equal(await trigger.isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '测试连接 synthetic-other', exact: true }).isDisabled(), true);
  const requests = await app.evaluate(() => globalThis.fixtureRequests);
  assert.deepEqual(requests, [{ url: 'https://api.deepseek.com/responses', redirect: 'error', body: { model: 'deepseek-v4-flash', input: 'Reply with exactly: OK', reasoning: { effort: 'none' }, max_output_tokens: 32, stream: false } }]);
  await app.evaluate(() => globalThis.finishModelTest());
  await page.getByText(/测试成功/).waitFor();
  const state = await page.evaluate(() => window.agentx.getModelSettings());
  assert.deepEqual(state.selectedModelIds, []);
  assert.equal(state.tests[0].outcome, 'passed');
  assert.equal(state.tests[0].expired, false);
  assert.ok(state.tests[0].testedAt);
  assert.ok(state.tests[0].durationMs >= 0);
  assert.equal(JSON.stringify(state).includes('synthetic-test-key'), false);
  assert.equal(JSON.stringify(state).includes('credentialRef'), false);
  await app.close();
  const reopened = await launch(data);
  t.after(() => reopened.app.close());
  assert.deepEqual((await reopened.page.evaluate(() => window.agentx.getModelSettings())).tests, state.tests);
});


test('testFailed：只呈现脱敏失败，保留勾选，重复操作和其他模型都不再调用', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  await app.evaluate(() => {
    globalThis.fixturePosts = 0;
    globalThis.fetch = async (_, init) => init.method === 'GET' ? new Response('{"data":[{"id":"deepseek-v4-flash"}]}', { status: 200 })
      : (globalThis.fixturePosts++, new Response('{"error":"synthetic-secret-must-not-echo"}', { status: 401 }));
  });
  const before = await page.evaluate(async () => {
    let state = await window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: 0, apiKey: 'synthetic-failure-key' });
    await window.agentx.fetchModelCatalog({ operationId: crypto.randomUUID(), expectedRevision: state.configRevision });
    return window.agentx.setSelectedModels({ operationId: crypto.randomUUID(), expectedRevision: state.configRevision, selectedModelIds: ['deepseek-v4-flash'] });
  });
  const operationId = require('node:crypto').randomUUID();
  const failed = await page.evaluate(value => window.agentx.testModel(value), { operationId, expectedRevision: before.configRevision, modelId: 'deepseek-v4-flash' });
  assert.equal(failed.tests[0].outcome, 'failed'); assert.match(failed.tests[0].error, /HTTP 401/);
  assert.equal(JSON.stringify(failed).includes('synthetic-secret'), false);
  assert.deepEqual(failed.selectedModelIds, before.selectedModelIds);
  await assert.rejects(page.evaluate(value => window.agentx.testModel(value), { operationId, expectedRevision: before.configRevision, modelId: 'deepseek-v4-flash' }), /不会重复调用/);
  await assert.rejects(page.evaluate(value => window.agentx.testModel(value), { operationId: require('node:crypto').randomUUID(), expectedRevision: before.configRevision, modelId: 'synthetic-other' }), /只允许测试/);
  assert.equal(await app.evaluate(() => globalThis.fixturePosts), 1);
  await assert.rejects(page.evaluate(revision => window.agentx.setActiveModel({ operationId: crypto.randomUUID(), expectedRevision: revision, activeModelId: 'deepseek-v4-flash' }), before.configRevision), /测试失败/);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '模型连接', exact: true }).click();
  await page.locator('.model-table').getByText(/测试失败/).waitFor();
});


test('fetching：离开再进入设置仍能收到最终列表，不重发请求或卡在加载', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  await app.evaluate(() => {
    globalThis.fixtureFetchCount = 0;
    globalThis.fetch = async () => { globalThis.fixtureFetchCount++; return new Promise(resolve => { globalThis.finishCatalog = () => resolve(new Response('{"data":[{"id":"deepseek-v4-flash"}]}', { status: 200 })); }); };
  });
  await page.evaluate(() => window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: 0, apiKey: 'synthetic-switch-page' }));
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '模型连接', exact: true }).click();
  await page.getByRole('button', { name: '拉取模型', exact: true }).click();
  await page.getByText('正在拉取模型，保留此前列表…', { exact: true }).waitFor();
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByText('正在拉取模型，保留此前列表…', { exact: true }).waitFor();
  await app.evaluate(() => globalThis.finishCatalog());
  await page.getByRole('checkbox', { name: '选择 deepseek-v4-flash' }).waitFor();
  await page.getByText('正在拉取模型，保留此前列表…', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await app.evaluate(() => globalThis.fixtureFetchCount), 1);
});


test('testExpired：旧测试回包只属于旧密钥，不能把更换后的配置标绿', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  await app.evaluate(() => {
    globalThis.fetch = async (_, init) => init.method === 'GET' ? new Response('{"data":[{"id":"deepseek-v4-flash"}]}', { status: 200 })
      : new Promise(resolve => { globalThis.finishOldTest = () => resolve(new Response(JSON.stringify({ object: 'response', status: 'completed', model: 'deepseek-v4-flash', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] }), { status: 200 })); });
  });
  await page.evaluate(async () => {
    const state = await window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: 0, apiKey: 'synthetic-old-test-key' });
    await window.agentx.fetchModelCatalog({ operationId: crypto.randomUUID(), expectedRevision: state.configRevision });
  });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '模型连接', exact: true }).click();
  await page.getByRole('button', { name: '测试连接 deepseek-v4-flash', exact: true }).click();
  await page.waitForFunction(async () => !!(await window.agentx.getModelSettings()).testing);
  await page.evaluate(async () => {
    const state = await window.agentx.getModelSettings();
    await window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: state.configRevision, apiKey: 'synthetic-new-test-key' });
  });
  await app.evaluate(() => globalThis.finishOldTest());
  await page.getByText(/测试已过期/).waitFor();
  assert.equal(await page.getByText(/测试成功/).count(), 0);
  const state = await page.evaluate(() => window.agentx.getModelSettings());
  assert.equal(state.tests[0].expired, true);
  assert.equal(state.tests[0].configRevision, 1);
  assert.equal(state.configRevision, 2);
});

test('fetchFailed：认证失败、超时和坏响应都保留最后成功目录及勾选，不自动重试', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  await app.evaluate(() => { globalThis.fetch = async () => new Response('{"data":[{"id":"deepseek-v4-flash"}]}', { status: 200 }); });
  const before = await page.evaluate(async () => {
    let state = await window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: 0, apiKey: 'synthetic-fetch-failure' });
    await window.agentx.fetchModelCatalog({ operationId: crypto.randomUUID(), expectedRevision: state.configRevision });
    return window.agentx.setSelectedModels({ operationId: crypto.randomUUID(), expectedRevision: state.configRevision, selectedModelIds: ['deepseek-v4-flash'] });
  });
  for (const [mode, pattern] of [['auth', /HTTP 401/], ['timeout', /超时/], ['bad', /格式无效/]]) {
    await app.evaluate((_, mode) => {
      globalThis.fixtureCalls = 0;
      globalThis.fetch = async () => {
        globalThis.fixtureCalls++;
        if (mode === 'timeout') throw new DOMException('synthetic-private-error', 'TimeoutError');
        return new Response(mode === 'auth' ? '{"error":"synthetic-private-error"}' : '{"data":[{}]}', { status: mode === 'auth' ? 401 : 200 });
      };
    }, mode);
    const after = await page.evaluate(revision => window.agentx.fetchModelCatalog({ operationId: crypto.randomUUID(), expectedRevision: revision }), before.configRevision);
    assert.match(after.fetchError, pattern);
    assert.equal(JSON.stringify(after).includes('synthetic-private-error'), false);
    assert.deepEqual(after.catalog, before.catalog);
    assert.deepEqual(after.selectedModelIds, before.selectedModelIds);
    assert.equal(await app.evaluate(() => globalThis.fixtureCalls), 1);
  }
});

test('catalogLoaded：拉取期间配置变化时丢弃旧回包，并清楚提示重新拉取', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  await app.evaluate(() => { globalThis.fetch = async () => new Promise(resolve => { globalThis.finishOldCatalog = () => resolve(new Response('{"data":[{"id":"deepseek-v4-flash"}]}', { status: 200 })); }); });
  await page.evaluate(async () => {
    const state = await window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: 0, apiKey: 'synthetic-catalog-key' });
    window.fixtureCatalog = window.agentx.fetchModelCatalog({ operationId: crypto.randomUUID(), expectedRevision: state.configRevision });
  });
  await page.waitForFunction(async () => (await window.agentx.getModelSettings()).fetching);
  await page.evaluate(async () => {
    const state = await window.agentx.getModelSettings();
    await window.agentx.setModelConnectionEnabled({ operationId: crypto.randomUUID(), expectedRevision: state.configRevision, enabled: false });
  });
  await app.evaluate(() => globalThis.finishOldCatalog());
  const state = await page.evaluate(() => window.fixtureCatalog);
  assert.match(state.fetchError, /旧列表未应用/);
  assert.equal(state.catalog.fetchedAt, null);
  assert.deepEqual(state.catalog.modelIds, []);
});


test('saved：晚到的旧读取不能覆盖已保存的当前设置', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const oldState = await page.evaluate(() => window.agentx.getModelSettings());
  const newState = await page.evaluate(() => window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: 0, apiKey: 'synthetic-read-order' }));
  await app.evaluate(({ ipcMain }, { oldState, newState }) => {
    let count = 0;
    ipcMain.removeHandler('agentx:model-settings-read');
    ipcMain.handle('agentx:model-settings-read', () => ++count === 1 ? new Promise(resolve => { globalThis.returnOldSettings = () => resolve(oldState); }) : newState);
  }, { oldState, newState: { ...newState, saving: false } });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '模型连接', exact: true }).click();
  await page.getByText('正在读取模型配置…', { exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('agentx:model-settings-changed'));
  await page.getByLabel('API Key', { exact: true }).waitFor();
  await app.evaluate(() => globalThis.returnOldSettings());
  // 再等一个 UI 事件回合，观察旧 Promise 真实落回后的可见配置。
  await page.getByRole('heading', { name: '模型连接', exact: true }).click();
  assert.match(await page.getByLabel('API Key', { exact: true }).getAttribute('placeholder'), /已保存/);
});


test('testFailed：结果落盘失败后重开，相同测试操作不能重复产生调用', { timeout: 45000 }, async t => {
  let current = await launch(); t.after(() => current.app.close());
  await current.app.evaluate(() => {
    globalThis.fetch = async (_, init) => init.method === 'GET' ? new Response('{"data":[{"id":"deepseek-v4-flash"}]}', { status: 200 })
      : new Promise(resolve => { globalThis.finishPersistTest = () => resolve(new Response(JSON.stringify({ object: 'response', status: 'completed', model: 'deepseek-v4-flash', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] }), { status: 200 })); });
  });
  const operationId = require('node:crypto').randomUUID();
  await current.page.evaluate(async operationId => {
    const state = await window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: 0, apiKey: 'synthetic-persist-test' });
    await window.agentx.fetchModelCatalog({ operationId: crypto.randomUUID(), expectedRevision: state.configRevision });
    window.fixtureTest = window.agentx.testModel({ operationId, expectedRevision: state.configRevision, modelId: 'deepseek-v4-flash' }).then(() => 'unexpected-success', error => error.message);
  }, operationId);
  await current.page.waitForFunction(async () => !!(await window.agentx.getModelSettings()).testing);
  await current.app.evaluate(({ app }) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    globalThis.lockedDatabase = new DatabaseSync(process.getBuiltinModule('node:path').join(app.getPath('userData'), 'agentx.db'));
    globalThis.lockedDatabase.exec('BEGIN EXCLUSIVE');
    globalThis.finishPersistTest();
  });
  assert.match(await current.page.evaluate(() => window.fixtureTest), /产品元数据/);
  await current.app.evaluate(() => { globalThis.lockedDatabase.exec('ROLLBACK'); globalThis.lockedDatabase.close(); });
  const data = current.data; await current.app.close(); current = await launch(data);
  await current.app.evaluate(() => { globalThis.fixturePosts = 0; globalThis.fetch = async () => { globalThis.fixturePosts++; return new Response('{}', { status: 503 }); }; });
  await assert.rejects(current.page.evaluate(operationId => window.agentx.testModel({ operationId, expectedRevision: 1, modelId: 'deepseek-v4-flash' }), operationId), /不会重复调用/);
  assert.equal(await current.app.evaluate(() => globalThis.fixturePosts), 0);
});


test('saveFailed：配置替换失败保留旧引用，重开也不把旧 Key 当作新配置使用', { timeout: 45000 }, async t => {
  let current = await launch(); t.after(() => current.app.close());
  await current.page.evaluate(() => window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: 0, apiKey: 'synthetic-committed-old' }));
  const fs = require('node:fs/promises'), path = require('node:path');
  const before = await fs.readFile(path.join(current.data, 'config.json'), 'utf8');
  await current.app.evaluate(() => {
    const fs = process.getBuiltinModule('node:fs'); const rename = fs.renameSync;
    fs.renameSync = (from, to) => { if (String(to).endsWith('config.json')) throw Object.assign(new Error('synthetic-private-write-error'), { code: 'EACCES' }); return rename(from, to); };
  });
  await assert.rejects(current.page.evaluate(() => window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: 1, apiKey: 'synthetic-uncommitted-new' })), /无法保存/);
  assert.equal(await fs.readFile(path.join(current.data, 'config.json'), 'utf8'), before);
  const cipher = await fs.readFile(path.join(current.data, 'secrets.enc'), 'utf8');
  assert.ok(JSON.parse(cipher).credentials[JSON.parse(before).modelConnection.credentialRef]);
  assert.equal(cipher.includes('synthetic-'), false);
  const data = current.data; await current.app.close(); current = await launch(data);
  await current.app.evaluate(() => { globalThis.fixtureRequests = 0; globalThis.fetch = async () => { globalThis.fixtureRequests++; return new Response('{"data":[]}', { status: 200 }); }; });
  const state = await current.page.evaluate(() => window.agentx.getModelSettings());
  assert.ok(state.keySaveError);
  await assert.rejects(current.page.evaluate(() => window.agentx.fetchModelCatalog({ operationId: crypto.randomUUID(), expectedRevision: 1 })), /上次密钥保存/);
  assert.equal(await current.app.evaluate(() => globalThis.fixtureRequests), 0);
  const saved = await current.page.evaluate(() => window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: 1, apiKey: 'synthetic-retry-success' }));
  assert.equal(saved.keySaveError, null);
});


test('editing：同一次离开 Key 输入并点击拉取，先完成新 Key 保存且只发一次新配置请求', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  await page.evaluate(() => window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: 0, apiKey: 'synthetic-previous' }));
  await app.evaluate(() => { globalThis.fixtureAuthorizations = []; globalThis.fetch = async (_, init) => { globalThis.fixtureAuthorizations.push(init.headers.Authorization === 'Bearer synthetic-new-from-blur'); return new Response('{"data":[]}', { status: 200 }); }; });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '模型连接', exact: true }).click();
  await page.getByLabel('API Key', { exact: true }).fill('synthetic-new-from-blur');
  await page.getByRole('button', { name: '拉取模型', exact: true }).click();
  await page.getByText('服务返回空模型列表。', { exact: true }).waitFor();
  assert.deepEqual(await app.evaluate(() => globalThis.fixtureAuthorizations), [true]);
  assert.equal((await page.evaluate(() => window.agentx.getModelSettings())).configRevision, 2);
});

test('输入与凭据边界：拒绝掩码、越权显隐和旧修订，损坏密文不外发且不覆盖', { timeout: 45000 }, async t => {
  const { app, page, data } = await launch(); t.after(() => app.close());
  for (const apiKey of ['', '••••••', '********', 'has space', 'bad\nkey']) {
    await assert.rejects(page.evaluate(apiKey => window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: 0, apiKey }), apiKey), /完整的 API Key/);
  }
  await page.evaluate(() => window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: 0, apiKey: 'synthetic-boundary-key' }));
  await assert.rejects(page.evaluate(() => window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: 0, apiKey: 'synthetic-stale-key' })), /配置已变化/);
  await assert.rejects(page.evaluate(() => window.agentx.revealModelKey(1)), /前台模型设置/);
  await assert.rejects(page.evaluate(() => window.agentx.setModelConnectionEnabled({ operationId: crypto.randomUUID(), expectedRevision: 1, enabled: 'true' })), /参数无效/);
  const fs = require('node:fs/promises'), path = require('node:path');
  const file = path.join(data, 'secrets.enc');
  const value = JSON.parse(await fs.readFile(file, 'utf8'));
  for (const id of Object.keys(value.credentials)) value.credentials[id] = Buffer.from('not-a-Windows-cipher').toString('base64');
  const corrupt = JSON.stringify(value); await fs.writeFile(file, corrupt, 'utf8');
  await app.evaluate(() => { globalThis.fixtureRequests = 0; globalThis.fetch = async () => { globalThis.fixtureRequests++; return new Response('{}'); }; });
  const state = await page.evaluate(() => window.agentx.fetchModelCatalog({ operationId: crypto.randomUUID(), expectedRevision: 1 }));
  assert.match(state.fetchError, /解密失败/);
  assert.equal(await fs.readFile(file, 'utf8'), corrupt);
  assert.equal(await app.evaluate(() => globalThis.fixtureRequests), 0);
});

test('保存与读取失败：不支持的数据库版本不清空重建，也不以空模型伪装成功', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => crashTestApp(app));
  await page.evaluate(() => window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: 0, apiKey: 'synthetic-db-version' }));
  await app.evaluate(({ app }) => { const { DatabaseSync } = process.getBuiltinModule('node:sqlite'); const db = new DatabaseSync(process.getBuiltinModule('node:path').join(app.getPath('userData'), 'agentx.db')); db.exec('PRAGMA user_version=999'); db.close(); });
  await assert.rejects(page.evaluate(() => window.agentx.getModelSettings()), /不会清空重建/);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '模型连接', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '产品元数据' }).waitFor();
  assert.equal(await app.evaluate(({ app }) => { const { DatabaseSync } = process.getBuiltinModule('node:sqlite'); const db = new DatabaseSync(process.getBuiltinModule('node:path').join(app.getPath('userData'), 'agentx.db')); const version = db.prepare('PRAGMA user_version').get().user_version; db.close(); return version; }), 999);
});


test('fetchFailed：过大的响应在读取上限处取消，不持续吞入整个响应体', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  await page.evaluate(() => window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: 0, apiKey: 'synthetic-response-limit' }));
  await app.evaluate(() => {
    globalThis.fixtureChunks = 0;
    globalThis.fetch = async () => new Response(new ReadableStream({ pull(controller) {
      if (globalThis.fixtureChunks === 12) { controller.close(); return; }
      globalThis.fixtureChunks++; controller.enqueue(new Uint8Array(256 * 1024));
    } }), { status: 200 });
  });
  const state = await page.evaluate(() => window.agentx.fetchModelCatalog({ operationId: crypto.randomUUID(), expectedRevision: 1 }));
  assert.match(state.fetchError, /响应无效/);
  assert.equal(state.catalog.fetchedAt, null);
  assert.ok(await app.evaluate(() => globalThis.fixtureChunks <= 6));
});


test('design QA：采用图对应的模型页在真实窗口浅深色与紧凑尺寸可达', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const fs = require('node:fs/promises'), path = require('node:path');
  const screenshots = path.resolve(__dirname, '../../.local-validation/m1-02/screenshots'); await fs.mkdir(screenshots, { recursive: true });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '模型连接', exact: true }).click();
  await page.getByLabel('API Key', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(screenshots, 'models-unconfigured-1280.png') });
  await app.evaluate(() => { globalThis.fetch = async (_, init) => new Response(JSON.stringify(init.method === 'GET' ? { data: [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-v4-pro' }] } : { object: 'response', status: 'completed', model: 'deepseek-v4-flash', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] }), { status: 200 }); });
  await page.evaluate(async () => {
    let state = await window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: 0, apiKey: 'synthetic-ui-only' });
    await window.agentx.fetchModelCatalog({ operationId: crypto.randomUUID(), expectedRevision: state.configRevision });
    state = await window.agentx.setSelectedModels({ operationId: crypto.randomUUID(), expectedRevision: state.configRevision, selectedModelIds: ['deepseek-v4-flash', 'deepseek-v4-pro'] });
    await window.agentx.testModel({ operationId: crypto.randomUUID(), expectedRevision: state.configRevision, modelId: 'deepseek-v4-flash' });
  });
  await page.locator('.model-table').getByText(/测试成功/).waitFor();
  assert.equal(await page.getByLabel('API Key', { exact: true }).inputValue(), '');
  await page.screenshot({ path: path.join(screenshots, 'models-selected-light-1280.png') });
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.getByRole('button', { name: '模型连接', exact: true }).click();
  await page.locator('.model-table').getByText(/测试成功/).waitFor();
  await page.screenshot({ path: path.join(screenshots, 'models-selected-dark-1280.png') });
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.getByRole('button', { name: '浅色', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.getByRole('button', { name: '模型连接', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
  await page.waitForFunction(() => innerWidth === 960 && innerHeight === 640);
  await page.getByRole('button', { name: '测试连接 deepseek-v4-flash', exact: true }).focus();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  for (const selector of ['#model-api-key', '.model-table']) {
    const box = await page.locator(selector).boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 960);
  }
  await page.screenshot({ path: path.join(screenshots, 'models-selected-light-960.png') });
});


test('selected：只改工作台候选不使同一凭据的进行中目录请求作废', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  await app.evaluate(() => { globalThis.fetch = async () => new Response('{"data":[{"id":"deepseek-v4-flash"}]}', { status: 200 }); });
  await page.evaluate(async () => {
    const state = await window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: 0, apiKey: 'synthetic-selection-inflight' });
    await window.agentx.fetchModelCatalog({ operationId: crypto.randomUUID(), expectedRevision: state.configRevision });
  });
  await app.evaluate(() => { globalThis.fetch = async () => new Promise(resolve => { globalThis.finishSelectionCatalog = () => resolve(new Response('{"data":[{"id":"deepseek-v4-flash"},{"id":"synthetic-new-candidate"}]}', { status: 200 })); }); });
  await page.evaluate(() => { window.fixtureSelectionCatalog = window.agentx.fetchModelCatalog({ operationId: crypto.randomUUID(), expectedRevision: 1 }); });
  await page.waitForFunction(async () => (await window.agentx.getModelSettings()).fetching);
  await page.evaluate(() => window.agentx.setSelectedModels({ operationId: crypto.randomUUID(), expectedRevision: 1, selectedModelIds: ['deepseek-v4-flash'] }));
  await app.evaluate(() => globalThis.finishSelectionCatalog());
  const state = await page.evaluate(() => window.fixtureSelectionCatalog);
  assert.equal(state.fetchError, null);
  assert.ok(state.catalog.modelIds.includes('synthetic-new-candidate'));
  assert.deepEqual(state.selectedModelIds, ['deepseek-v4-flash']);
});


test('revealed：编辑中的 Key 单击眼睛即可显隐，离开整个密钥控件才提交', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '模型连接', exact: true }).click();
  await page.getByLabel('API Key', { exact: true }).fill('synthetic-eye-editing');
  await page.getByRole('button', { name: '显示 API Key', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#model-api-key')?.type === 'text');
  assert.equal(await page.getByLabel('API Key', { exact: true }).inputValue(), 'synthetic-eye-editing');
  assert.equal((await page.evaluate(() => window.agentx.getModelSettings())).hasCredential, false);
  await page.getByRole('button', { name: '隐藏 API Key', exact: true }).click();
  await page.getByRole('heading', { name: '模型连接', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '密钥已保存' }).waitFor();
  assert.equal((await page.evaluate(() => window.agentx.getModelSettings())).configRevision, 1);
});
