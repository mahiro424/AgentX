const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch, crashTestApp } = require('./helpers.cjs');

async function seedSearchTasks(app) {
  return app.evaluate(({ app, BrowserWindow }, repository) => {
    const req = process.getBuiltinModule('node:module').createRequire(repository + '/package.json');
    req('ts-node').register({ transpileOnly: true, project: repository + '/tsconfig.json' });
    const root = app.getPath('userData');
    const project = req(repository + '/src/main/storage/projects.ts').associateProject(root, root).project;
    const now = new Date().toISOString();
    const tasks = ['整理季度经营报告', '核对收入数据'].map(title => ({
      taskId: process.getBuiltinModule('node:crypto').randomUUID(), projectId: project.projectId, directory: root,
      title, lastActivityAt: now, observedAt: now, executionState: 'idle', threadId: null, turnId: null,
    }));
    for (const task of tasks) req(repository + '/src/main/storage/tasks.ts').createTaskRecord(root, task);
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed');
    return tasks;
  }, path.resolve('.'));
}

test('搜索入口：图标与 Ctrl+K 打开真实标题查询，Escape 返回原焦点并保留草稿', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const tasks = await seedSearchTasks(app);
  await page.getByRole('button', { name: tasks[0].title, exact: true }).waitFor();
  const draft = page.getByRole('textbox', { name: '任务要求', exact: true });
  await draft.fill('不要丢失这份输入');
  const before = await page.evaluate(() => window.agentx.getWorkspace());
  const trigger = page.getByRole('button', { name: '搜索会话', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '搜索会话', exact: true });
  await dialog.waitFor();
  const query = dialog.getByRole('textbox', { name: '搜索会话内容', exact: true });
  await query.fill('季度');
  await dialog.getByRole('button', { name: `打开会话：${tasks[0].title}`, exact: true }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: `打开会话：${tasks[1].title}`, exact: true }).count(), 0);
  assert.equal(await dialog.locator('mark').first().innerText(), '季度');
  await query.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
  assert.equal(await draft.inputValue(), '不要丢失这份输入');
  await draft.focus(); await draft.press('Control+k');
  await dialog.waitFor();
  assert.equal(await query.inputValue(), '季度');
  await query.press('Escape');
  assert.equal(await draft.evaluate(element => element === document.activeElement), true);
  assert.deepEqual(await page.evaluate(() => window.agentx.getWorkspace()), before);
});

test('搜索键盘：组合输入不打开命中或关闭浮层，Tab 保持在浮层内，确认后 Enter 才打开', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const [task] = await seedSearchTasks(app);
  const draft = page.getByRole('textbox', { name: '任务要求', exact: true });
  await draft.focus();
  await draft.dispatchEvent('keydown', { key: 'k', ctrlKey: true, isComposing: true, bubbles: true });
  const dialog = page.getByRole('dialog', { name: '搜索会话', exact: true });
  assert.equal(await dialog.isVisible(), false);
  await draft.press('Control+k');
  const query = dialog.getByRole('textbox', { name: '搜索会话内容' });
  await query.fill('季度');
  const hit = dialog.getByRole('button', { name: `打开会话：${task.title}`, exact: true }); await hit.waitFor();
  await page.waitForFunction(() => !document.querySelector('.search-result')?.disabled);
  await query.focus(); await query.press('Shift+Tab');
  assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true);
  for (let count = 0; count < 16; count++) {
    await page.keyboard.press('Tab');
    assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true, '键盘焦点不能越过模态浮层');
  }
  await query.focus();
  await query.dispatchEvent('compositionstart', { data: '季', bubbles: true });
  await query.dispatchEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true });
  await query.press('Enter'); // 即使 native isComposing 缺失，组合输入锁也必须保护。
  await query.press('Escape');
  assert.equal(await dialog.isVisible(), true); assert.equal(await query.inputValue(), '季度');
  await query.dispatchEvent('compositionend', { data: '季度', bubbles: true });
  await query.press('Enter');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal((await page.evaluate(() => window.agentx.getExecution())).task, null);
});

test('搜索旧响应：较早查询的成功或失败晚到，不覆盖新查询结果与加载状态', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const tasks = await seedSearchTasks(app);
  await page.getByRole('button', { name: '搜索会话', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '搜索会话', exact: true });
  await dialog.getByText('已覆盖 2/2 个会话', { exact: true }).waitFor();
  await app.evaluate(({ app, ipcMain }, repository) => {
    const req = process.getBuiltinModule('node:module').createRequire(repository + '/package.json');
    const service = new (req(repository + '/src/main/services/task-search.ts').TaskSearchService)(app.getPath('userData'), async () => { throw new Error('本测试查询不读取引擎'); });
    globalThis.delayedSearchReplies = [];
    ipcMain.removeHandler('agentx:task-search');
    ipcMain.handle('agentx:task-search', async (_event, request) => {
      const value = await service.query(request);
      if (request.query !== '季度') return value;
      return new Promise((resolve, reject) => globalThis.delayedSearchReplies.push({ resolve: () => resolve(value), reject }));
    });
  }, path.resolve('.'));
  const query = dialog.getByRole('textbox', { name: '搜索会话内容' });
  for (const outcome of ['resolve', 'reject']) {
    await query.fill('季度');
    await app.evaluate(() => new Promise((resolve, reject) => {
      const deadline = Date.now() + 3000;
      const poll = () => globalThis.delayedSearchReplies.length ? resolve() : Date.now() > deadline ? reject(new Error('未收到待延迟的查询')) : setTimeout(poll, 10);
      poll();
    }));
    await query.fill('收入');
    const fresh = dialog.getByRole('button', { name: `打开会话：${tasks[1].title}`, exact: true }); await fresh.waitFor();
    await app.evaluate((_electron, outcome) => {
      for (const reply of globalThis.delayedSearchReplies.splice(0)) reply[outcome](new Error('较早查询的延迟失败'));
    }, outcome);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await query.inputValue(), '收入'); assert.equal(await fresh.isDisabled(), false);
    assert.equal(await dialog.getByRole('button', { name: `打开会话：${tasks[0].title}`, exact: true }).count(), 0);
    assert.equal(await dialog.getByRole('alert').count(), 0);
    assert.equal(await dialog.getByRole('group', { name: '搜索结果' }).getAttribute('aria-busy'), 'false');
  }
});

test('索引入口：显式重建更新真实覆盖，关闭浮层不启动任务，重新打开仍能读取进度', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  await seedSearchTasks(app);
  const before = await page.evaluate(() => window.agentx.getWorkspace());
  await page.getByRole('button', { name: '搜索会话', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '搜索会话', exact: true });
  await dialog.getByText('已覆盖 0/2 个会话', { exact: false }).waitFor();
  await dialog.getByRole('button', { name: '重建索引', exact: true }).click();
  await dialog.getByText('已覆盖 2/2 个会话', { exact: true }).waitFor();
  await dialog.getByRole('textbox', { name: '搜索会话内容', exact: true }).press('Escape');
  await page.getByRole('button', { name: '搜索会话', exact: true }).click();
  await dialog.getByText('已覆盖 2/2 个会话', { exact: true }).waitFor();
  const state = await page.evaluate(() => window.agentx.getSearchIndexState());
  assert.deepEqual(state, { running: false, processed: 2, total: 2, error: null });
  await dialog.getByRole('textbox', { name: '搜索会话内容', exact: true }).press('Escape');
  assert.deepEqual(await page.evaluate(() => window.agentx.getWorkspace()), before);
  assert.equal((await page.evaluate(() => window.agentx.getExecution())).task, null);
});

test('损坏索引界面：错误保留查询筛选与旧结果，显式重建后恢复且草稿不丢失', { timeout: 45000 }, async t => {
  const { app, page, data } = await launch(); t.after(() => app.close());
  const [task] = await seedSearchTasks(app);
  const draft = page.getByRole('textbox', { name: '任务要求' }); await draft.fill('索引损坏也必须保留的草稿');
  const before = await page.evaluate(() => window.agentx.getWorkspace());
  await page.getByRole('button', { name: '搜索会话', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '搜索会话', exact: true });
  const query = dialog.getByRole('textbox', { name: '搜索会话内容' });
  await query.fill('季度');
  await dialog.getByRole('combobox', { name: '搜索项目' }).selectOption(task.projectId);
  await dialog.getByRole('checkbox', { name: '包含已归档' }).check();
  await dialog.getByText('已覆盖 2/2 个会话', { exact: true }).waitFor();
  const hit = dialog.getByRole('button', { name: `打开会话：${task.title}`, exact: true }); await hit.waitFor();
  await require('node:fs/promises').writeFile(path.join(data, 'cache', 'search.sqlite'), '合成损坏索引，不能当空历史');
  await query.fill('季度经营');
  await dialog.getByRole('alert').filter({ hasText: '查询、筛选与原结果仍保留' }).waitFor();
  assert.equal(await hit.count(), 1); assert.equal(await hit.isDisabled(), true);
  assert.equal(await query.inputValue(), '季度经营');
  assert.equal(await dialog.getByRole('combobox', { name: '搜索项目' }).inputValue(), task.projectId);
  assert.equal(await dialog.getByRole('checkbox', { name: '包含已归档' }).isChecked(), true);
  await dialog.getByRole('button', { name: '重建索引', exact: true }).click();
  await dialog.getByRole('status').filter({ hasText: '损坏索引已保留' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.search-result')?.disabled);
  assert.equal(await dialog.getByRole('alert').count(), 0);
  assert.equal(await query.inputValue(), '季度经营');
  await query.press('Escape');
  assert.equal(await draft.inputValue(), '索引损坏也必须保留的草稿');
  assert.deepEqual(await page.evaluate(() => window.agentx.getWorkspace()), before);
  assert.equal((await page.evaluate(() => window.agentx.getExecution())).task, null);
});

test('命中历史：定位失败保留查询并可重试，成功后精确聚焦，离开再次选择必须重读', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const [task] = await seedSearchTasks(app);
  await app.evaluate(async ({ app, ipcMain, BrowserWindow }, { repository, taskId }) => {
    const req = process.getBuiltinModule('node:module').createRequire(repository + '/package.json');
    req('ts-node').register({ transpileOnly: true, project: repository + '/tsconfig.json' });
    const root = app.getPath('userData'), { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const db = new DatabaseSync(root + '/agentx.db');
    try { db.prepare("UPDATE tasks SET execution_state='completed', thread_id='source-thread', turn_id='source-turn' WHERE task_id=?").run(taskId); }
    finally { db.close(); }
    const history = { taskId, threadId: 'source-thread', turns: [{ turnId: 'source-turn', status: 'completed', unrepresentedItemTypes: [],
      items: [{ kind: 'message', threadId: 'source-thread', turnId: 'source-turn', itemId: 'source-message', text: '这条消息是精确命中的来源', phase: 'final_answer', status: 'completed' }] }] };
    const service = new (req(repository + '/src/main/services/task-search.ts').TaskSearchService)(root, async () => history);
    await service.rebuild();
    // 仅把公开历史读取边界替换为确定夹具；搜索存储、查询和定位校验仍运行实际服务。
    globalThis.failSearchLocation = true;
    ipcMain.removeHandler('agentx:task-search-locate');
    ipcMain.handle('agentx:task-search-locate', (_event, value) => {
      if (globalThis.failSearchLocation) throw new Error('合成命中来源读取故障');
      return service.locate(value);
    });
    ipcMain.removeHandler('agentx:task-history-read');
    ipcMain.handle('agentx:task-history-read', () => { throw new Error('离开后原历史读取故障'); });
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed');
  }, { repository: path.resolve('.'), taskId: task.taskId });
  await page.getByRole('button', { name: '搜索会话', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '搜索会话', exact: true });
  await dialog.getByRole('textbox', { name: '搜索会话内容' }).fill('精确命中');
  await dialog.getByRole('combobox', { name: '搜索项目' }).selectOption(task.projectId);
  await dialog.getByRole('checkbox', { name: '包含已归档' }).check();
  const hit = dialog.getByRole('button', { name: `打开会话：${task.title}`, exact: true });
  await hit.click();
  await dialog.getByRole('alert').filter({ hasText: '合成命中来源读取故障' }).waitFor();
  assert.equal(await hit.isDisabled(), true);
  assert.equal(await dialog.getByRole('textbox', { name: '搜索会话内容' }).inputValue(), '精确命中');
  assert.equal(await dialog.getByRole('combobox', { name: '搜索项目' }).inputValue(), task.projectId);
  assert.equal(await dialog.getByRole('checkbox', { name: '包含已归档' }).isChecked(), true);
  assert.equal(await page.locator('.search-hit-target').count(), 0);
  await app.evaluate(() => { globalThis.failSearchLocation = false; });
  await dialog.getByRole('button', { name: '重试搜索', exact: true }).click();
  await hit.click();
  await dialog.waitFor({ state: 'hidden' });
  const target = page.locator('.search-hit-target');
  await target.waitFor();
  assert.equal(await target.getAttribute('data-history-item'), 'source-message');
  await page.waitForFunction(() => document.activeElement?.classList.contains('search-hit-target'));
  assert.equal(await page.getByRole('alert').filter({ hasText: '离开后原历史读取故障' }).count(), 0);
  await page.getByRole('button', { name: '新会话', exact: true }).click();
  await page.getByRole('button', { name: task.title, exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '离开后原历史读取故障' }).waitFor();
  assert.equal(await target.count(), 0);
});

test('后台索引刷新：保留用户键盘选中行与焦点，不因新执行通知重置选择', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  await seedSearchTasks(app);
  await page.getByRole('button', { name: '搜索会话', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '搜索会话', exact: true });
  const query = dialog.getByRole('textbox', { name: '搜索会话内容' });
  await dialog.getByRole('button', { name: /^打开会话：/ }).nth(1).waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-search-index="1"]').disabled);
  await query.press('ArrowDown');
  const selected = await dialog.locator('[aria-current="true"]').getAttribute('aria-label');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed'));
  await page.waitForFunction(() => !document.querySelector('[aria-label="搜索结果"]').getAttribute('aria-busy') || document.querySelector('[aria-label="搜索结果"]').getAttribute('aria-busy') === 'false');
  await page.waitForTimeout(200);
  assert.equal(await dialog.locator('[aria-current="true"]').getAttribute('aria-label'), selected);
  assert.equal(await query.evaluate(element => element === document.activeElement), true);
  await query.press('Escape');
});

test('活动命中：定位公开用户消息后仍保留停止，后续执行消息继续显示', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => crashTestApp(app));
  const task = await app.evaluate(async ({ app, ipcMain, BrowserWindow }, repository) => {
    const req = process.getBuiltinModule('node:module').createRequire(repository + '/package.json');
    req('ts-node').register({ transpileOnly: true, project: repository + '/tsconfig.json' });
    const root = app.getPath('userData'), projects = req(repository + '/src/main/storage/projects.ts');
    const project = projects.associateProject(root, root).project, now = new Date().toISOString();
    const taskId = process.getBuiltinModule('node:crypto').randomUUID();
    req(repository + '/src/main/storage/tasks.ts').createTaskRecord(root, { taskId, projectId: project.projectId, directory: root, title: '当前轮定位夹具', executionState: 'running', threadId: 'active-thread', turnId: 'active-turn', lastActivityAt: now, observedAt: now });
    const task = projects.readWorkspace(root).tasks.find(task => task.taskId === taskId);
    const history = { taskId, threadId: task.threadId, turns: [{ turnId: task.turnId, status: 'inProgress', unrepresentedItemTypes: [], items: [{ kind: 'userMessage', threadId: task.threadId, turnId: task.turnId, itemId: 'active-user', text: '活动用户消息精确来源' }] }] };
    const service = new (req(repository + '/src/main/services/task-search.ts').TaskSearchService)(root, async () => history);
    await service.rebuild();
    // 仅在公开历史/执行快照边界使用夹具；实际索引、源项校验和 Renderer 均不替换。
    globalThis.searchLiveFixture = { preparing: false, task, operationId: null, items: [], approvals: [], error: null, inputText: '活动用户消息精确来源' };
    ipcMain.removeHandler('agentx:execution-read'); ipcMain.handle('agentx:execution-read', () => globalThis.searchLiveFixture);
    ipcMain.removeHandler('agentx:task-search-locate'); ipcMain.handle('agentx:task-search-locate', (_event, value) => service.locate(value));
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed');
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:execution-changed');
    return task;
  }, path.resolve('.'));
  await page.getByRole('button', { name: '搜索会话', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '搜索会话', exact: true });
  await dialog.getByRole('textbox', { name: '搜索会话内容' }).fill('精确来源');
  await dialog.getByRole('button', { name: `打开会话：${task.title}`, exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const target = page.locator('.search-hit-target'); await target.waitFor();
  assert.equal(await target.getAttribute('data-history-item'), 'active-user');
  assert.equal(await page.getByLabel('已提交的要求', { exact: true }).count(), 1);
  await page.getByRole('button', { name: '停止', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    const value = globalThis.searchLiveFixture;
    value.items.push({ kind: 'message', threadId: value.task.threadId, turnId: value.task.turnId, itemId: 'after-location', text: '定位之后仍收到的真实快照字段', status: 'running', phase: 'commentary' });
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:execution-changed');
  });
  await page.getByText('定位之后仍收到的真实快照字段', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '停止', exact: true }).count(), 1);
});

test('归档命中：默认隐藏，显式包含后可在结果旁恢复，不开始执行且保留查询', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const [task] = await seedSearchTasks(app);
  await page.evaluate(taskId => window.agentx.setTaskArchived({ taskId, operationId: crypto.randomUUID(), archived: true, expectedRevision: 0 }), task.taskId);
  await page.getByRole('button', { name: '搜索会话', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '搜索会话', exact: true });
  const query = dialog.getByRole('textbox', { name: '搜索会话内容' });
  await query.fill('季度');
  await dialog.getByText(/未找到匹配会话/).waitFor();
  await dialog.getByRole('checkbox', { name: '包含已归档' }).check();
  await dialog.getByRole('button', { name: `打开会话：${task.title}`, exact: true }).waitFor();
  const before = (await page.evaluate(() => window.agentx.getWorkspace())).tasks.find(value => value.taskId === task.taskId);
  await dialog.getByRole('button', { name: `恢复会话：${task.title}`, exact: true }).click();
  await dialog.getByRole('button', { name: `恢复会话：${task.title}`, exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await query.inputValue(), '季度');
  const restored = (await page.evaluate(() => window.agentx.getWorkspace())).tasks.find(value => value.taskId === task.taskId);
  assert.equal(restored.archivedAt, null);
  assert.deepEqual({ ...restored, archivedAt: before.archivedAt, organizationRevision: before.organizationRevision }, before);
  await query.press('Escape');
  assert.equal((await page.evaluate(() => window.agentx.getExecution())).task, null);
});
