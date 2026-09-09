const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch, crashTestApp } = require('./helpers.cjs');

for (const continuation of [false, true]) test(`大输出停止控件：${continuation ? '续轮准备后' : '运行中'}大体积结果不隐藏主按钮，单次点击保留准确关联`, { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => crashTestApp(app));
  await app.evaluate(({ app, ipcMain, BrowserWindow }, { repository, continuation }) => {
    const req = process.getBuiltinModule('node:module').createRequire(repository + '/package.json');
    req('ts-node').register({ transpileOnly: true, project: repository + '/tsconfig.json' });
    const root = app.getPath('userData'), uuid = process.getBuiltinModule('node:crypto').randomUUID, now = new Date().toISOString();
    const taskId = uuid(), directory = process.getBuiltinModule('node:path').join(root, 'workspaces', taskId);
    process.getBuiltinModule('node:fs').mkdirSync(directory, { recursive: true });
    const task = { taskId, projectId: null, directory, title: '大表输出停止核对', lastActivityAt: now, observedAt: now,
      executionState: continuation ? 'interrupted' : 'running', threadId: 'large-output-thread', turnId: continuation ? 'previous-turn' : 'large-output-turn' };
    req(repository + '/src/main/storage/tasks.ts').createTaskRecord(root, task);
    const snapshot = { preparing: false, task, operationId: uuid(), error: null, approvals: [], items: [] };
    ipcMain.removeHandler('agentx:execution-read'); ipcMain.handle('agentx:execution-read', () => snapshot);
    ipcMain.removeHandler('agentx:task-history-read'); ipcMain.handle('agentx:task-history-read', () => ({ taskId, threadId: task.threadId,
      turns: [{ turnId: 'previous-turn', status: 'interrupted', items: [], unrepresentedItemTypes: [] }] }));
    globalThis.prepareLargeOutputTurn = () => {
      snapshot.preparing = true;
      BrowserWindow.getAllWindows()[0].webContents.send('agentx:execution-changed');
    };
    globalThis.largeOutputControls = [];
    ipcMain.removeHandler('agentx:execution-stop'); ipcMain.handle('agentx:execution-stop', (_event, request) => {
      globalThis.largeOutputControls.push(request); snapshot.task.executionState = 'stopping';
      BrowserWindow.getAllWindows()[0].webContents.send('agentx:execution-changed');
    });
    globalThis.deliverLargeOutput = () => {
      snapshot.preparing = false; task.executionState = 'running'; task.turnId = 'large-output-turn';
      snapshot.items = [{ kind: 'command', threadId: task.threadId, turnId: task.turnId, itemId: 'large-text', directory: root,
        command: '读取大型合成表格数据', status: 'completed', output: '合成行值\n'.repeat(150000), exitCode: 0, durationMs: 500 },
      { kind: 'command', threadId: task.threadId, turnId: task.turnId, itemId: 'office-write', directory: root,
        command: '运行表格工具', status: 'running', output: '', exitCode: null, durationMs: null }];
      BrowserWindow.getAllWindows()[0].webContents.send('agentx:execution-changed');
    };
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed');
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:execution-changed');
  }, { repository: path.resolve('.'), continuation });
  await page.getByRole('button', { name: '大表输出停止核对', exact: true }).click();
  if (continuation) {
    await app.evaluate(() => globalThis.prepareLargeOutputTurn());
    await page.getByText('正在提交，请等待确认，不会重复发送。', { exact: true }).waitFor();
  }
  await app.evaluate(() => globalThis.deliverLargeOutput());
  await page.getByText('运行表格工具', { exact: true }).waitFor();
  const stop = page.getByRole('button', { name: '停止', exact: true }); assert.equal(await stop.isEnabled(), true);
  await stop.click();
  await page.getByText('正在停止，等待引擎确认…', { exact: true }).waitFor();
  const calls = await app.evaluate(() => globalThis.largeOutputControls);
  assert.equal(calls.length, 1); assert.equal(calls[0].threadId, 'large-output-thread'); assert.equal(calls[0].turnId, 'large-output-turn');
  assert.equal(await stop.isDisabled(), true);
});
