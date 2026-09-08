const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch } = require('./helpers.cjs');

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

test('命中历史：原消息精确聚焦，离开后再次选择必须重读，不能复用先前搜索快照', { timeout: 45000 }, async t => {
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
    ipcMain.removeHandler('agentx:task-search-locate');
    ipcMain.handle('agentx:task-search-locate', (_event, value) => service.locate(value));
    ipcMain.removeHandler('agentx:task-history-read');
    ipcMain.handle('agentx:task-history-read', () => { throw new Error('离开后原历史读取故障'); });
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed');
  }, { repository: path.resolve('.'), taskId: task.taskId });
  await page.getByRole('button', { name: '搜索会话', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '搜索会话', exact: true });
  await dialog.getByRole('textbox', { name: '搜索会话内容' }).fill('精确命中');
  await dialog.getByRole('button', { name: `打开会话：${task.title}`, exact: true }).click();
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
