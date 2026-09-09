const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch } = require('./helpers.cjs');

test('independentDraft：未关联项目的真实输入与最近分组，IPC 合成执行结果不制造项目', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  await app.evaluate(({ app, ipcMain, BrowserWindow }, repository) => {
    const req = process.getBuiltinModule('node:module').createRequire(repository + '/package.json');
    req('ts-node').register({ transpileOnly: true, project: repository + '/tsconfig.json' });
    const root = app.getPath('userData'), model = 'deepseek-v4-flash';
    // 可用模型配置以已初始化的数据库为前提；不通过创建假项目来准备此条件。
    req(repository + '/src/main/storage/database.ts').withDatabase(root, () => undefined);
    let task = null;
    const changed = () => {
      BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed');
      BrowserWindow.getAllWindows()[0].webContents.send('agentx:execution-changed');
    };
    // 本测试只验证 Renderer/IPC/SQLite；真实协调服务与 Codex 调用另有单测和 Flash 现场验收。
    for (const [channel, handler] of Object.entries({
      'agentx:model-settings-read': () => ({ hasCredential: true, enabled: true, configRevision: 1, activeModelId: model,
        selectedModelIds: [model], catalog: { modelIds: [model], fetchedAt: null, configRevision: 1 }, fetching: false,
        saving: false, fetchError: null, keySaveError: null, testing: null, tests: [] }),
      'agentx:execution-start': (_event, request) => {
        if (request.projectId !== null) throw new Error('测试要求未关联项目');
        const now = new Date().toISOString(), directory = req('node:path').join(root, 'workspaces', request.taskId);
        req('node:fs').mkdirSync(directory, { recursive: true });
        task = { taskId: request.taskId, projectId: null, directory, title: request.text, lastActivityAt: now,
          observedAt: now, executionState: 'completed', threadId: 'desktop-independent-thread', turnId: 'desktop-independent-turn' };
        req(repository + '/src/main/storage/tasks.ts').createTaskRecord(root, task); changed(); return task;
      },
      'agentx:execution-read': () => ({ preparing: false, task, operationId: null, items: [], approvals: [], error: null }),
      'agentx:task-history-read': () => ({ taskId: task.taskId, threadId: task.threadId,
        turns: [{ turnId: task.turnId, status: 'completed', items: [], unrepresentedItemTypes: [] }] }),
    })) { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler); }
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:model-settings-changed'); changed();
  }, path.resolve('.'));
  const draft = page.getByRole('textbox', { name: '任务要求' });
  assert.equal(await page.getByRole('combobox', { name: '工作目录' }).inputValue(), '');
  await page.waitForFunction(() => !document.querySelector('#task-draft').disabled);
  await draft.fill('整理独立文本材料');
  await page.waitForFunction(() => !document.querySelector('[aria-label="发送"]').disabled);
  await draft.press('Enter');
  await page.getByRole('region', { name: '最近会话', exact: true }).getByRole('button', { name: '整理独立文本材料', exact: true }).waitFor();
  const workspace = await page.evaluate(() => window.agentx.getWorkspace());
  assert.deepEqual(workspace.projects, []); assert.equal(workspace.tasks.length, 1);
  assert.equal(workspace.tasks[0].projectId, null);
  assert.ok(workspace.tasks[0].directory.endsWith(path.join('workspaces', workspace.tasks[0].taskId)));
  await page.waitForFunction(() => document.querySelector('#task-draft').value === '');
  await page.getByRole('button', { name: '整理独立文本材料', exact: true }).hover();
  await page.getByRole('button', { name: '置顶会话：整理独立文本材料', exact: true }).click();
  await page.getByRole('region', { name: '置顶会话', exact: true }).getByRole('button', { name: '整理独立文本材料', exact: true }).waitFor();
  await page.getByRole('button', { name: '整理独立文本材料', exact: true }).hover();
  await page.getByRole('button', { name: '取消置顶会话：整理独立文本材料', exact: true }).click();
  await page.getByText('已取消置顶，会话回到最近分组', { exact: true }).waitFor();
});
