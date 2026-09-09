const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launch } = require('./helpers.cjs');

test('首次材料发送确认：材料归入原任务，新对话不自动带上已发送材料，原件仍保留', { timeout: 45000 }, async t => {
  const { app, page, data } = await launch(); t.after(() => app.close());
  const filename = path.join(data, '只属于本任务.txt'); await fs.writeFile(filename, '材料事实');
  await app.evaluate(({ app, dialog, ipcMain, BrowserWindow }, { repository, filename }) => {
    const req = process.getBuiltinModule('node:module').createRequire(repository + '/package.json');
    req('ts-node').register({ transpileOnly: true, project: repository + '/tsconfig.json' });
    const root = app.getPath('userData'), tasks = req(repository + '/src/main/storage/tasks.ts');
    const fs = process.getBuiltinModule('node:fs/promises'), path = process.getBuiltinModule('node:path');
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
    ipcMain.removeHandler('agentx:model-settings-read');
    ipcMain.handle('agentx:model-settings-read', () => ({ hasCredential: true, enabled: true, configRevision: 1,
      activeModelId: 'deepseek-v4-flash', selectedModelIds: ['deepseek-v4-flash'], catalog: { modelIds: ['deepseek-v4-flash'], fetchedAt: null, configRevision: 1 },
      fetching: false, saving: false, fetchError: null, keySaveError: null, testing: null, tests: [] }));
    ipcMain.removeHandler('agentx:execution-start');
    ipcMain.handle('agentx:execution-start', async (_event, request) => {
      const materials = await new (req(repository + '/src/main/services/materials.ts').MaterialService)(root).freeze({ projectId: null, taskId: null }, request.text, request.materials);
      const now = new Date().toISOString(), directory = path.join(root, 'workspaces', request.taskId); await fs.mkdir(directory, { recursive: true });
      const task = { taskId: request.taskId, projectId: null, directory, title: request.text, executionState: 'submitting', threadId: null, turnId: null, lastActivityAt: now, observedAt: now };
      tasks.beginTaskSubmission(root, task, { ...request, materials, credentialRef: process.getBuiltinModule('node:crypto').randomUUID() });
      tasks.markSubmissionDispatched(root, task.taskId, request.operationId); tasks.bindSubmissionThread(root, task.taskId, request.operationId, 'material-transfer-thread');
      tasks.acknowledgeSubmission(root, task.taskId, request.operationId, 'material-transfer-thread', 'material-transfer-turn');
      tasks.settleTaskTurn(root, task.taskId, request.operationId, 'material-transfer-thread', 'material-transfer-turn', 'completed');
      Object.assign(task, { executionState: 'completed', threadId: 'material-transfer-thread', turnId: 'material-transfer-turn' });
      ipcMain.removeHandler('agentx:task-history-read');
      ipcMain.handle('agentx:task-history-read', () => ({ taskId: task.taskId, threadId: task.threadId, turns: [{ turnId: task.turnId, status: 'completed', items: [], unrepresentedItemTypes: [] }] }));
      ipcMain.removeHandler('agentx:execution-read');
      ipcMain.handle('agentx:execution-read', () => ({ preparing: false, task, operationId: request.operationId, inputText: request.text, items: [], approvals: [], error: null }));
      BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed'); BrowserWindow.getAllWindows()[0].webContents.send('agentx:execution-changed');
      return task;
    });
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:model-settings-changed');
  }, { repository: path.resolve('.'), filename });
  await page.getByRole('button', { name: '添加材料', exact: true }).click(); await page.getByRole('menuitem', { name: '添加文件', exact: true }).click();
  await page.getByRole('list', { name: '本轮材料' }).waitFor();
  await page.getByRole('textbox', { name: '任务要求' }).fill('整理当前材料');
  await page.waitForFunction(() => !document.querySelector('[aria-label="发送"]').disabled);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('button', { name: '查看文件改动', exact: true }).waitFor();
  await page.getByRole('status').filter({ hasText: '草稿已保存' }).waitFor();
  const [task] = (await page.evaluate(() => window.agentx.getWorkspace())).tasks;
  assert.equal((await page.evaluate(taskId => window.agentx.getDraft({ projectId: null, taskId }), task.taskId)).materials.length, 1);
  await page.getByRole('button', { name: '新会话', exact: true }).click();
  await page.getByRole('heading', { name: '今天想完成什么工作？' }).waitFor();
  assert.equal(await page.getByRole('list', { name: '本轮材料' }).count(), 0);
  assert.equal((await page.evaluate(() => window.agentx.getDraft({ projectId: null, taskId: null }))).materials.length, 0);
  assert.equal(await fs.readFile(filename, 'utf8'), '材料事实');
});

test('材料控件：唯一加号经原生选择保存，取消不添加，重开恢复，移除保留原件', { timeout: 60000 }, async () => {
  let { app, page, data } = await launch();
  const file = path.join(data, '合成说明.txt');
  await fs.writeFile(file, '唯一事实：交付日为周五');
  try {
    await page.getByRole('button', { name: '添加材料', exact: true }).click();
    await page.getByRole('menu', { name: '添加材料' }).waitFor();
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
    await page.getByRole('menuitem', { name: '添加文件', exact: true }).click();
    assert.equal((await page.evaluate(() => window.agentx.getDraft({ projectId: null, taskId: null }))).materials.length, 0);
    await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, file);
    await page.getByRole('button', { name: '添加材料', exact: true }).click();
    await page.getByRole('menuitem', { name: '添加文件', exact: true }).click();
    await page.getByRole('list', { name: '本轮材料' }).getByText('合成说明.txt', { exact: true }).waitFor();
    await page.getByRole('status').filter({ hasText: '草稿已保存' }).waitFor();
    const saved = await page.evaluate(() => window.agentx.getDraft({ projectId: null, taskId: null }));
    assert.equal(saved.materials.length, 1);
    assert.equal((await page.evaluate(() => window.agentx.getWorkspace())).tasks.length, 0);
    await app.close(); ({ app, page } = await launch(data));
    await page.getByRole('list', { name: '本轮材料' }).getByText('合成说明.txt', { exact: true }).waitFor();
    await page.getByRole('button', { name: '移除材料：合成说明.txt' }).click();
    await page.getByRole('status').filter({ hasText: '草稿已保存' }).waitFor();
    assert.deepEqual((await page.evaluate(() => window.agentx.getDraft({ projectId: null, taskId: null }))).materials, []);
    assert.equal(await fs.readFile(file, 'utf8'), '唯一事实：交付日为周五');
  } finally { await app.close(); }
});

test('材料拖放与失效：真实 File 经 Preload 登记、重复不增加，外部变化重查采用新版本，缺失保留材料', { timeout: 60000 }, async t => {
  const { app, page, data } = await launch(); t.after(() => app.close());
  const file = path.join(data, '拖入的材料.md'); await fs.writeFile(file, '# 旧内容');
  await page.evaluate(() => { const element = document.createElement('input'); element.type = 'file'; element.id = 'test-native-file'; document.body.appendChild(element); });
  await page.locator('#test-native-file').setInputFiles(file);
  const drop = () => page.evaluate(() => {
    const data = new DataTransfer(); data.items.add(document.querySelector('#test-native-file').files[0]);
    document.querySelector('.composer').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
  });
  await drop();
  const list = page.getByRole('list', { name: '本轮材料' }); await list.getByText('拖入的材料.md', { exact: true }).waitFor();
  await page.getByRole('status').filter({ hasText: '草稿已保存' }).waitFor();
  const initial = await page.evaluate(() => window.agentx.getDraft({ projectId: null, taskId: null }));
  await drop(); await page.getByRole('button', { name: '添加材料', exact: true }).waitFor();
  assert.equal(await list.getByRole('listitem').count(), 1);
  await fs.writeFile(file, '# 外部修改');
  await page.reload(); await list.getByText(/内容或身份已变化/).waitFor();
  await page.getByRole('button', { name: '重查材料：拖入的材料.md' }).click();
  await list.getByText('可读取；尚不代表 Agent 已读取', { exact: true }).waitFor();
  await page.getByRole('status').filter({ hasText: '草稿已保存' }).waitFor();
  const refreshed = await page.evaluate(() => window.agentx.getDraft({ projectId: null, taskId: null }));
  assert.notEqual(refreshed.materials[0].materialId, initial.materials[0].materialId);
  await fs.unlink(file); await page.reload(); await list.getByText(/已移动或删除/).waitFor();
  assert.equal(await list.getByRole('listitem').count(), 1);
  assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);
});

test('图片粘贴：经 Main 剪贴板接口持久化图片，含图发送明确阻断，正文草稿保留', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jEAAAAABJRU5ErkJggg==';
  await app.evaluate(({ clipboard }, base64) => {
    const bytes = Buffer.from(base64, 'base64');
    clipboard.read = async () => [{ types: ['image/png'], getType: async () => new Blob([bytes], { type: 'image/png' }) }];
  }, png);
  const draft = page.getByRole('textbox', { name: '任务要求' }); await draft.fill('图片暂不能发送时保留这段要求');
  await draft.evaluate(element => {
    const data = new DataTransfer(); data.items.add(new File(['synthetic-image-marker'], 'paste.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await page.getByRole('list', { name: '本轮材料' }).getByText('图像能力尚未验证，含图发送已阻断', { exact: true }).waitFor();
  await page.getByRole('status').filter({ hasText: '草稿已保存' }).waitFor();
  const saved = await page.evaluate(() => window.agentx.getDraft({ projectId: null, taskId: null }));
  assert.equal(saved.text, '图片暂不能发送时保留这段要求'); assert.equal(saved.materials[0].status, 'blockedImage');
  assert.deepEqual(await fs.readFile(saved.materials[0].path), Buffer.from(png, 'base64'));
  assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);
  assert.equal((await page.evaluate(() => window.agentx.getWorkspace())).tasks.length, 0);
});
