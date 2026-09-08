const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch, crashTestApp } = require('./helpers.cjs');

for (const navigateAway of [false, true]) test(`首次发送：${navigateAway ? '切换项目再回来不被迟到结果导航' : '失败保留草稿，确认后进入对应任务'}`, { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => crashTestApp(app));
  const project = await app.evaluate(({ app, ipcMain, BrowserWindow }, repository) => {
    const req = process.getBuiltinModule('node:module').createRequire(repository + '/package.json');
    req('ts-node').register({ transpileOnly: true, project: repository + '/tsconfig.json' });
    const root = app.getPath('userData');
    const project = req(repository + '/src/main/storage/projects.ts').associateProject(root, root).project;
    const model = 'deepseek-v4-flash';
    ipcMain.removeHandler('agentx:model-settings-read');
    ipcMain.handle('agentx:model-settings-read', () => ({ hasCredential: true, enabled: true, configRevision: 3,
      activeModelId: model, selectedModelIds: [model], catalog: { modelIds: [model], fetchedAt: null, configRevision: 3 },
      fetching: false, saving: false, fetchError: null, keySaveError: null, testing: null, tests: [] }));
    globalThis.submitRequests = [];
    ipcMain.removeHandler('agentx:execution-start');
    ipcMain.handle('agentx:execution-start', (_event, request) => {
      globalThis.submitRequests.push(request);
      if (globalThis.submitRequests.length === 1) throw new Error('合成准备失败，尚未创建任务');
      return new Promise(resolve => {
        globalThis.finishSubmit = () => {
          const now = new Date().toISOString();
          const task = { taskId: request.taskId, projectId: project.projectId, directory: root, title: request.text,
            lastActivityAt: now, observedAt: now, executionState: 'running', threadId: 'submit-thread', turnId: 'submit-turn' };
          req(repository + '/src/main/storage/tasks.ts').createTaskRecord(root, task);
          ipcMain.removeHandler('agentx:execution-read');
          ipcMain.handle('agentx:execution-read', () => ({ preparing: false, task, operationId: request.operationId, inputText: request.text, items: [], approvals: [], error: null }));
          BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed');
          BrowserWindow.getAllWindows()[0].webContents.send('agentx:execution-changed');
          resolve(task);
        };
      });
    });
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed');
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:model-settings-changed');
    return project;
  }, path.resolve('.'));
  await page.getByRole('combobox', { name: '工作目录' }).selectOption(project.projectId);
  const draft = page.getByRole('textbox', { name: '任务要求' });
  await draft.fill('修复合成项目');
  await page.waitForFunction(() => !document.querySelector('[aria-label="发送"]').disabled);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '合成准备失败' }).waitFor();
  assert.equal(await draft.inputValue(), '修复合成项目');
  await draft.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  assert.equal(await app.evaluate(() => globalThis.submitRequests.length), 1);
  await draft.press('Control+Enter');
  assert.equal(await app.evaluate(() => globalThis.submitRequests.length), 1);
  assert.equal(await draft.inputValue(), '修复合成项目\n');
  await draft.fill('前选中后');
  await draft.evaluate(element => element.setSelectionRange(1, 3));
  await draft.press('Control+Enter');
  assert.equal(await draft.inputValue(), '前\n后');
  await draft.press('A');
  assert.equal(await draft.inputValue(), '前\nA后');
  assert.equal(await app.evaluate(() => globalThis.submitRequests.length), 1);
  await draft.fill('修复合成项目');
  await draft.press('Enter');
  await page.waitForFunction(() => document.querySelector('[aria-label="发送"]').disabled);
  assert.equal(await app.evaluate(() => globalThis.submitRequests.length), 2);
  await draft.fill('发送期间新写的要求');
  if (navigateAway) {
    await page.getByRole('combobox', { name: '工作目录' }).selectOption('');
    await page.getByRole('combobox', { name: '工作目录' }).selectOption(project.projectId);
  }
  await app.evaluate(() => globalThis.finishSubmit());
  if (navigateAway) {
    await page.getByRole('button', { name: '查看活动或待核对任务' }).waitFor();
    assert.equal(await page.getByRole('heading', { level: 1, name: '今天想完成什么工作？' }).count(), 1);
    assert.equal(await page.getByRole('button', { name: '停止', exact: true }).count(), 0);
  } else {
    await page.getByRole('button', { name: '停止', exact: true }).waitFor();
    await page.getByRole('region', { name: '已提交的要求', exact: true }).waitFor();
    assert.equal(await page.getByRole('region', { name: '已提交的要求', exact: true }).textContent(), '修复合成项目');
  }
  assert.equal(await draft.inputValue(), '发送期间新写的要求');
  const requests = await app.evaluate(() => globalThis.submitRequests);
  assert.equal(requests[1].projectId, project.projectId);
  assert.equal(requests[1].modelId, 'deepseek-v4-flash');
  assert.equal(requests[1].configRevision, 3);
  assert.equal(requests[1].text, '修复合成项目');
  assert.notEqual(requests[0].operationId, requests[1].operationId);
});

test('草稿换行：动画帧延迟时下一按键仍插在换行之后', { timeout: 30000 }, async t => {
  const { app, page } = await launch(); t.after(() => crashTestApp(app));
  const draft = page.getByRole('textbox', { name: '任务要求' });
  await draft.fill('前选中后');
  await draft.evaluate(element => element.setSelectionRange(1, 3));
  await delayInputFrames(page);
  try {
    await draft.press('Control+Enter');
    await draft.press('A');
    assert.equal(await draft.inputValue(), '前\nA后');
  } finally { await page.evaluate(() => globalThis.restoreInputFrames()); }
});

test('草稿换行：后来的全选不被旧帧覆盖，替换内容重开仍保留', { timeout: 90000 }, async () => {
  let { app, page, data } = await launch();
  try {
    const draft = page.getByRole('textbox', { name: '任务要求' });
    await draft.fill('换行前的要求');
    await delayInputFrames(page);
    try {
      await draft.press('Control+Enter');
      await draft.press('Control+A');
    } finally { await page.evaluate(() => globalThis.restoreInputFrames()); }
    await page.keyboard.insertText('替换后的要求');
    assert.equal(await draft.inputValue(), '替换后的要求');
    await page.waitForFunction(async () => (await window.agentx.getDraft({ projectId: null, taskId: null })).text === '替换后的要求');
    assert.equal((await page.evaluate(() => window.agentx.getWorkspace())).tasks.length, 0);
    await app.close();
    ({ app, page } = await launch(data));
    await page.waitForFunction(() => document.querySelector('#task-draft').value === '替换后的要求');
    assert.equal((await page.evaluate(() => window.agentx.getWorkspace())).tasks.length, 0);
  } finally { await app.close(); }
});

async function delayInputFrames(page) {
  await page.evaluate(() => {
    // 延迟浏览器动画帧，仍用真实键盘输入；不能让帧等待掩盖下一按键的错误位置。
    const original = requestAnimationFrame;
    const frames = [];
    globalThis.requestAnimationFrame = callback => frames.push(callback);
    globalThis.restoreInputFrames = () => {
      globalThis.requestAnimationFrame = original;
      for (const frame of frames) frame(performance.now());
      delete globalThis.restoreInputFrames;
    };
  });
}
