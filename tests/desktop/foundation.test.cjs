const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const artifacts = path.join(root, '.local-validation/foundation');

const { launch } = require('./helpers.cjs');

test('default / empty：真实桌面显示空工作台，不制造会话或模型连接', { timeout: 45000 }, async t => {
  await fs.mkdir(artifacts, { recursive: true });
  const { app, page } = await launch();
  t.after(() => app.close());
  await page.getByRole('heading', { name: '今天想完成什么工作？' }).waitFor({ timeout: 5000 });
  assert.equal(await page.title(), 'AgentX');
  assert.equal(await page.getByRole('button', { name: '发送' , exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '配置模型', exact: true }).count(), 1);
  assert.equal(await page.getByText('优化导出逻辑').count(), 0);
  const info = await page.evaluate(() => window.agentx.getAppInfo());
  assert.equal(info.name, 'AgentX');
  assert.equal(info.stage, 'foundation');
});

test('empty：说明没有记录，新会话准备入口聚焦且保留草稿', { timeout: 20000 }, async t => {
  const { app, page } = await launch();
  t.after(() => app.close());
  await page.getByText('尚无项目或会话', { exact: true }).waitFor({ timeout: 2000 });
  const draft = page.getByRole('textbox', { name: '任务要求' });
  await draft.fill('先写下待完成的工作');
  await page.getByRole('button', { name: '新会话', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.id === 'task-draft');
  assert.equal(await draft.inputValue(), '先写下待完成的工作');
  assert.equal(await page.getByText('最近', { exact: true }).count(), 0);
});

test('loading：主进程未返回信息时显示加载，返回后消失', { timeout: 20000 }, async t => {
  const { app, page } = await launch();
  t.after(() => app.close());
  await app.evaluate(({ ipcMain, app: desktop }) => {
    ipcMain.removeHandler('agentx:app-info');
    ipcMain.handle('agentx:app-info', () => new Promise(resolve => {
      globalThis.finishInfoFixture = () => resolve({ name: desktop.getName(), version: desktop.getVersion(), platform: process.platform, stage: 'foundation' });
    }));
  });
  await page.reload();
  try {
    await page.getByRole('status').filter({ hasText: '正在读取应用信息' }).waitFor({ timeout: 2000 });
  } finally {
    await app.evaluate(() => { globalThis.finishInfoFixture?.(); delete globalThis.finishInfoFixture; });
  }
  await page.getByRole('status').filter({ hasText: '正在读取应用信息' }).waitFor({ state: 'hidden', timeout: 2000 });
});

test('error：读取失败可重试，草稿不因错误或重试丢失', { timeout: 20000 }, async t => {
  const { app, page } = await launch();
  t.after(() => app.close());
  await app.evaluate(({ ipcMain, app: desktop }) => {
    let attempts = 0;
    ipcMain.removeHandler('agentx:app-info');
    ipcMain.handle('agentx:app-info', () => {
      if (++attempts === 1) throw new Error('合成读取故障');
      return { name: desktop.getName(), version: desktop.getVersion(), platform: process.platform, stage: 'foundation' };
    });
  });
  await page.reload();
  await page.getByRole('alert').waitFor({ timeout: 2000 });
  const draft = page.getByRole('textbox', { name: '任务要求' });
  await draft.fill('错误时也要保留这份草稿');
  await page.getByRole('button', { name: '重试', exact: true }).click({ timeout: 2000 });
  await page.getByRole('alert').waitFor({ state: 'hidden', timeout: 2000 });
  assert.equal(await draft.inputValue(), '错误时也要保留这份草稿');
});

test('disabled：未选项目有草稿仍不能发送，显示原因且不暴露未接入入口', { timeout: 20000 }, async t => {
  const { app, page } = await launch();
  t.after(() => app.close());
  const draft = page.getByRole('textbox', { name: '任务要求' });
  await draft.fill('请修复项目');
  await draft.press('Control+Enter');
  assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);
  await page.getByRole('note').filter({ hasText: '请先选择本地项目' }).waitFor({ timeout: 2000 });
  for (const name of ['项目管理', '全部任务', '添加附件', '完全访问']) {
    assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0);
  }
  assert.match(await draft.inputValue(), /请修复项目/);
});

test('compact：真实窗口缩小时收起侧栏，可恢复并用键盘调宽', { timeout: 20000 }, async t => {
  const { app, page } = await launch();
  t.after(() => app.close());
  const divider = page.getByRole('separator', { name: '调整侧栏宽度' });
  await divider.waitFor({ timeout: 2000 });
  const width = Number(await divider.getAttribute('aria-valuenow'));
  await divider.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(previous => Number(document.querySelector('[role="separator"]')?.getAttribute('aria-valuenow')) > previous, width);
  assert.ok(Number(await divider.getAttribute('aria-valuenow')) > width);
  const draft = page.getByRole('textbox', { name: '任务要求' });
  await draft.fill('收起侧栏也保留输入');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
  await page.getByRole('complementary', { name: '侧栏' }).waitFor({ state: 'hidden', timeout: 2000 });
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await page.getByRole('complementary', { name: '侧栏' }).waitFor();
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '展开侧栏');
  assert.equal(await draft.inputValue(), '收起侧栏也保留输入');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isVisible(), true);
});

// Windows 的 Chromium 清理可能耗时数十秒；重开用例单独预算，UI 操作仍限时 5 秒。
test('theme：主题和真实缩放生效，重开后仍保持；切页保留草稿', { timeout: 90000 }, async t => {
  let current = await launch();
  t.after(() => current.app.close());
  await current.page.getByRole('textbox', { name: '任务要求' }).fill('切页不能丢失');
  await current.page.getByRole('button', { name: '设置', exact: true }).click({ timeout: 2000 });
  await current.page.getByRole('button', { name: '深色', exact: true }).click();
  await current.page.waitForFunction(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  await current.page.getByRole('combobox', { name: '界面缩放' }).selectOption('1.25');
  await current.page.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  assert.equal(await current.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()), 1.25);
  await current.page.getByRole('button', { name: '返回工作台', exact: true }).click();
  assert.equal(await current.page.getByRole('textbox', { name: '任务要求' }).inputValue(), '切页不能丢失');
  const data = current.data;
  await current.app.close();
  current = await launch(data);
  const preferences = await current.page.evaluate(() => window.agentx.getPreferences());
  assert.deepEqual(preferences, { theme: 'dark', zoom: 1.25 });
  assert.equal(await current.app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors), true);
});

test('keyboard：缩窄窗口不把侧栏中的键盘焦点丢给页面正文', { timeout: 20000 }, async t => {
  const { app, page } = await launch();
  t.after(() => app.close());
  await page.getByRole('separator', { name: '调整侧栏宽度' }).focus();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '展开侧栏');
  assert.equal(await page.getByRole('button', { name: '展开侧栏', exact: true }).evaluate(node => getComputedStyle(node).outlineStyle), 'solid');
  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('button', { name: '新会话', exact: true }).evaluate(node => document.activeElement === node), true);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.id === 'task-draft');
  const draft = page.getByRole('textbox', { name: '任务要求' });
  await draft.fill('中文组合输入');
  await draft.dispatchEvent('compositionstart', { data: '' });
  await draft.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', ctrlKey: true, isComposing: true });
  await draft.dispatchEvent('compositionend', { data: '中文组合输入' });
  assert.equal(await draft.inputValue(), '中文组合输入');
  assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);
});

test('theme error：保存失败显示实际原因，不覆盖损坏配置或草稿', { timeout: 20000 }, async t => {
  const { app, page, data } = await launch();
  t.after(() => app.close());
  await page.getByRole('textbox', { name: '任务要求' }).fill('保存失败也保留');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '跟随系统', exact: true }).waitFor();
  const damaged = '{"schemaVersion":999,"syntheticRecord":"保留故障证据"}';
  await fs.writeFile(path.join(data, 'config.json'), damaged, 'utf8');
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '本地偏好版本不受支持' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '跟随系统', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await fs.readFile(path.join(data, 'config.json'), 'utf8'), damaged);
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: '任务要求' }).inputValue(), '保存失败也保留');
});

test('data capability：打包 Main 的 SQLite 事务与系统加密可跨进程重开', { timeout: 90000 }, async t => {
  let current = await launch();
  t.after(() => current.app.close());
  const created = await current.app.evaluate(async ({ app, safeStorage }) => {
    const fs = process.getBuiltinModule('node:fs');
    const path = process.getBuiltinModule('node:path');
    const { randomBytes, createHash } = process.getBuiltinModule('node:crypto');
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const root = app.getPath('userData');
    const database = new DatabaseSync(path.join(root, 'capability-probe.sqlite'));
    try {
      database.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
      database.prepare('INSERT INTO probe VALUES (?, ?)').run(1, '已提交');
      database.exec('BEGIN');
      database.prepare('UPDATE probe SET value = ? WHERE id = ?').run('应回滚', 1);
      database.exec('ROLLBACK');
    } finally { database.close(); }
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('打包环境的系统凭据保护不可用，禁止明文替代');
    const plaintext = randomBytes(32).toString('base64url');
    const encrypted = await safeStorage.encryptStringAsync(plaintext);
    const decrypted = await safeStorage.decryptStringAsync(encrypted);
    const digest = createHash('sha256').update(plaintext).digest('hex');
    fs.writeFileSync(path.join(root, 'capability-probe.enc'), encrypted, { flag: 'wx' });
    fs.writeFileSync(path.join(root, 'capability-probe.sha256'), digest, { flag: 'wx' });
    return { packaged: app.isPackaged, electron: process.versions.electron, node: process.versions.node,
      sameProcess: decrypted.result === plaintext, ciphertextOnly: !encrypted.includes(Buffer.from(plaintext)) };
  });
  assert.equal(created.packaged, true);
  assert.equal(created.electron, '44.2.0');
  assert.equal(created.sameProcess, true);
  assert.equal(created.ciphertextOnly, true);
  const data = current.data;
  await current.app.close();
  current = await launch(data);
  const restored = await current.app.evaluate(async ({ app, safeStorage }) => {
    const fs = process.getBuiltinModule('node:fs');
    const path = process.getBuiltinModule('node:path');
    const { createHash } = process.getBuiltinModule('node:crypto');
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const root = app.getPath('userData');
    const database = new DatabaseSync(path.join(root, 'capability-probe.sqlite'));
    let row;
    try { row = database.prepare('SELECT value FROM probe WHERE id = ?').get(1); } finally { database.close(); }
    const decrypted = await safeStorage.decryptStringAsync(fs.readFileSync(path.join(root, 'capability-probe.enc')));
    return { value: row.value, samePlaintext: createHash('sha256').update(decrypted.result).digest('hex') === fs.readFileSync(path.join(root, 'capability-probe.sha256'), 'utf8') };
  });
  assert.deepEqual(restored, { value: '已提交', samePlaintext: true });
  t.diagnostic(`真实打包环境：Electron ${created.electron}，Node ${created.node}；合成数据事务与跨进程解密通过`);
});

test('IPC：仅暴露产品桥，拒绝非法偏好且不更改原配置', { timeout: 20000 }, async t => {
  const { app, page, data } = await launch();
  t.after(() => app.close());
  const surface = await page.evaluate(() => ({ keys: Object.keys(window.agentx).sort(), frozen: Object.isFrozen(window.agentx), nodeAccess: typeof window.require }));
  assert.deepEqual(surface, { keys: ['answerExecutionApproval', 'answerExit', 'chooseProject', 'continueExecution', 'copyOutput', 'fetchModelCatalog', 'getAppInfo', 'getDraft', 'getExecution', 'getExitState', 'getModelSettings', 'getPreferences', 'getReconciliation', 'getTaskHistory', 'getTaskResults', 'getWorkspace', 'onExecutionChanged', 'onExitChanged', 'onModelSettingsChanged', 'onWorkspaceChanged', 'renameProject', 'renameTask', 'revealModelKey', 'saveDraft', 'saveModelKey', 'savePreferences', 'setActiveModel', 'setModelConnectionEnabled', 'setModelSettingsVisible', 'setSelectedModels', 'setTaskArchived', 'setTaskPinned', 'startExecution', 'steerExecution', 'stopExecution', 'testModel'], frozen: true, nodeAccess: 'undefined' });
  await page.evaluate(() => window.agentx.savePreferences({ theme: 'light', zoom: 1 }));
  const previous = await fs.readFile(path.join(data, 'config.json'), 'utf8');
  for (const invalid of [null, [], { theme: 'dark', zoom: 2 }, { theme: 'unknown', zoom: 1 }, { theme: 'dark', zoom: 1, extra: true }]) {
    await assert.rejects(page.evaluate(value => window.agentx.savePreferences(value), invalid), /偏好值无效|主题或界面缩放值无效/);
    assert.equal(await fs.readFile(path.join(data, 'config.json'), 'utf8'), previous);
  }
  assert.deepEqual(await page.evaluate(() => window.agentx.getPreferences()), { theme: 'light', zoom: 1 });
});

test('IPC 来源：相同地址的其他窗口也不能写入产品偏好', { timeout: 20000 }, async t => {
  const { app, page, data } = await launch();
  t.after(() => app.close());
  const foreignPreload = path.join(data, 'foreign-preload.cjs');
  await fs.writeFile(foreignPreload, "const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('foreignClient',{save:()=>ipcRenderer.invoke('agentx:preferences-save',{theme:'dark',zoom:1.5})});", 'utf8');
  const denied = await app.evaluate(async ({ BrowserWindow }, preload) => {
    const product = BrowserWindow.getAllWindows()[0];
    const other = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    try {
      await other.loadURL(product.webContents.getURL());
      return await other.webContents.executeJavaScript("window.foreignClient.save().then(() => false, error => error.message.includes('拒绝非产品主页面'))");
    } finally { other.destroy(); }
  }, foreignPreload);
  assert.equal(denied, true);
  assert.deepEqual(await page.evaluate(() => window.agentx.getPreferences()), { theme: 'system', zoom: 1 });
});
