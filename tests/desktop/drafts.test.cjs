const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch } = require('./helpers.cjs');

test('草稿产品桥：真实 SQLite 重开保存内容，拒绝任意字段和过期覆盖，不创建任务', { timeout: 45000 }, async () => {
  const startedAt = Date.now();
  const stage = name => console.log(`[draft-bridge] ${name} +${Date.now() - startedAt}ms`);
  stage('启动前');
  let { app, page, data } = await launch();
  stage('首次窗口就绪');
  try {
    const scope = { projectId: null, taskId: null };
    assert.deepEqual(await page.evaluate(value => window.agentx.getDraft(value), scope), { ...scope, text: '', revision: 0, materials: [] });
    const saved = await page.evaluate(value => window.agentx.saveDraft(value), { ...scope, text: '未发送的中文草稿\n第二行', expectedRevision: 0 });
    assert.equal(saved.revision, 1);
    stage('草稿写入确认');
    await assert.rejects(page.evaluate(value => window.agentx.saveDraft(value), { ...scope, text: '错误覆盖', expectedRevision: 0 }), /草稿|记录/);
    await assert.rejects(page.evaluate(value => window.agentx.getDraft(value), { ...scope, path: 'arbitrary-file' }), /草稿/);
    assert.equal((await page.evaluate(() => window.agentx.getWorkspace())).tasks.length, 0);
    stage('关闭首次窗口前');
    await app.close();
    stage('首次窗口已关闭');
    ({ app, page } = await launch(data));
    stage('重开窗口就绪');
    assert.deepEqual(await page.evaluate(value => window.agentx.getDraft(value), scope), saved);
  } finally { stage('最终关闭前'); await app.close(); stage('最终关闭完成'); }
});

test('草稿保存失败：保留新编辑，显式重试保存最新文本，不发送任务', { timeout: 30000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  await app.evaluate(({ app, ipcMain }, repository) => {
    const req = process.getBuiltinModule('node:module').createRequire(repository + '/package.json');
    req('ts-node').register({ transpileOnly: true, project: repository + '/tsconfig.json' });
    const { saveDraft } = req(repository + '/src/main/storage/drafts.ts');
    globalThis.draftSaveAttempts = 0;
    ipcMain.removeHandler('agentx:draft-save');
    ipcMain.handle('agentx:draft-save', (_event, request) => {
      if (++globalThis.draftSaveAttempts === 1) throw new Error('合成草稿写入失败');
      return saveDraft(app.getPath('userData'), request);
    });
  }, path.resolve('.'));
  const draft = page.getByRole('textbox', { name: '任务要求' });
  await draft.fill('写入失败时的内容');
  await page.getByRole('alert').filter({ hasText: '合成草稿写入失败' }).waitFor();
  await draft.fill('失败后继续编辑的最新内容');
  assert.equal(await app.evaluate(() => globalThis.draftSaveAttempts), 1);
  await page.getByRole('button', { name: '重试草稿保存或读取' }).click();
  await page.getByRole('status').filter({ hasText: '草稿已保存' }).waitFor();
  assert.equal((await page.evaluate(() => window.agentx.getDraft({ projectId: null, taskId: null }))).text, '失败后继续编辑的最新内容');
  assert.equal((await page.evaluate(() => window.agentx.getWorkspace())).tasks.length, 0);
});

test('草稿输入：未关联、项目和会话内容分别恢复，重开应用仍保留', { timeout: 45000 }, async () => {
  let { app, page, data } = await launch();
  try {
    const draft = () => page.getByRole('textbox', { name: '任务要求' });
    await draft().fill('未关联草稿');
    assert.equal(await page.getByRole('status').filter({ hasText: '草稿' }).count(), 1);
    await page.getByRole('status').filter({ hasText: '草稿已保存' }).waitFor();
    const result = await app.evaluate(({ app, BrowserWindow }, repository) => {
      const req = process.getBuiltinModule('node:module').createRequire(repository + '/package.json');
      req('ts-node').register({ transpileOnly: true, project: repository + '/tsconfig.json' });
      const root = app.getPath('userData'), now = new Date().toISOString();
      const project = req(repository + '/src/main/storage/projects.ts').associateProject(root, root).project;
      const taskId = process.getBuiltinModule('node:crypto').randomUUID();
      req(repository + '/src/main/storage/tasks.ts').createTaskRecord(root, { taskId, projectId: project.projectId, directory: root,
        title: '已有会话草稿', executionState: 'completed', threadId: 'draft-thread', turnId: 'draft-turn', lastActivityAt: now, observedAt: now });
      BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed');
      return { project, taskId };
    }, path.resolve('.'));
    await page.getByRole('combobox', { name: '工作目录' }).selectOption(result.project.projectId);
    await draft().fill('项目草稿');
    await page.getByRole('status').filter({ hasText: '草稿已保存' }).waitFor();
    await page.getByRole('button', { name: '已有会话草稿', exact: true }).click();
    await draft().fill('会话补充草稿');
    await page.getByRole('status').filter({ hasText: '草稿已保存' }).waitFor();
    await page.getByRole('button', { name: '新会话', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#task-draft').value === '项目草稿');
    await app.close(); ({ app, page } = await launch(data));
    await page.waitForFunction(() => document.querySelector('#task-draft').value === '未关联草稿');
    await page.getByRole('button', { name: '已有会话草稿', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#task-draft').value === '会话补充草稿');
  } finally { await app.close(); }
});
