const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch } = require('./helpers.cjs');

async function seed(app) {
  return app.evaluate(({ app, BrowserWindow, ipcMain }, repository) => {
    const req = process.getBuiltinModule('node:module').createRequire(repository + '/package.json');
    req('ts-node').register({ transpileOnly: true, project: repository + '/tsconfig.json' });
    const root = app.getPath('userData'), uuid = process.getBuiltinModule('node:crypto').randomUUID;
    const project = req(repository + '/src/main/storage/projects.ts').associateProject(root, root).project;
    const store = req(repository + '/src/main/storage/tasks.ts'), read = () => req(repository + '/src/main/storage/projects.ts').readWorkspace(root).tasks[0];
    const now = new Date().toISOString(), taskId = uuid(), operationId = uuid(), model = 'deepseek-v4-flash';
    store.beginTaskSubmission(root, { taskId, projectId: project.projectId, directory: root, title: '同会话继续工作', executionState: 'submitting',
      threadId: null, turnId: null, lastActivityAt: now, observedAt: now }, { operationId, modelId: model, configRevision: 1, credentialRef: uuid(), text: '第一轮要求' });
    store.markSubmissionDispatched(root, taskId, operationId); store.bindSubmissionThread(root, taskId, operationId, 'continue-ui-thread');
    store.acknowledgeSubmission(root, taskId, operationId, 'continue-ui-thread', 'ui-turn-1'); store.settleTaskTurn(root, taskId, operationId, 'continue-ui-thread', 'ui-turn-1', 'completed');
    const history = { taskId, threadId: 'continue-ui-thread', turns: [{ turnId: 'ui-turn-1', status: 'completed', unrepresentedItemTypes: [], items: [
      { kind: 'message', threadId: 'continue-ui-thread', turnId: 'ui-turn-1', itemId: 'message-1', text: '第一轮历史结果', status: 'completed', phase: 'final_answer' },
    ] }] };
    const snapshot = { preparing: false, task: read(), operationId, inputText: '第一轮要求', items: [], approvals: [], error: null };
    const notify = () => { for (const channel of ['agentx:workspace-changed', 'agentx:execution-changed']) BrowserWindow.getAllWindows()[0].webContents.send(channel); };
    for (const channel of ['agentx:task-history-read', 'agentx:execution-read', 'agentx:model-settings-read']) ipcMain.removeHandler(channel);
    ipcMain.handle('agentx:task-history-read', () => history);
    ipcMain.handle('agentx:execution-read', () => snapshot);
    ipcMain.handle('agentx:model-settings-read', () => ({ hasCredential: true, enabled: true, configRevision: 4,
      activeModelId: model, selectedModelIds: [model], catalog: { modelIds: [model], fetchedAt: null, configRevision: 4 },
      fetching: false, saving: false, fetchError: null, keySaveError: null, testing: null, tests: [] }));
    globalThis.continueRequests = []; globalThis.failContinue = false;
    ipcMain.removeHandler('agentx:execution-continue');
    ipcMain.handle('agentx:execution-continue', async (_event, request) => {
      globalThis.continueRequests.push(request);
      if (globalThis.failContinue) throw new Error('合成新配置准备失败');
      const materials = await new (req(repository + '/src/main/services/materials.ts').MaterialService)(root)
        .freeze({ projectId: request.projectId, taskId: request.taskId }, request.text, request.materials);
      snapshot.preparing = true; notify();
      return new Promise(resolve => {
        globalThis.finishContinuation = () => {
          const previous = read(); store.beginTaskContinuation(root, previous, { ...request, materials, credentialRef: uuid() });
          store.markSubmissionDispatched(root, taskId, request.operationId);
          store.acknowledgeSubmission(root, taskId, request.operationId, previous.threadId, 'ui-turn-2');
          Object.assign(snapshot, { preparing: false, task: read(), operationId: request.operationId, inputText: request.text,
            items: [{ kind: 'message', threadId: previous.threadId, turnId: 'ui-turn-2', itemId: 'message-2', text: '正在执行第二轮', status: 'running', phase: 'commentary' }] });
          globalThis.completeContinuation = () => {
            store.settleTaskTurn(root, taskId, request.operationId, previous.threadId, 'ui-turn-2', 'completed'); snapshot.task = read();
            history.turns.push({ turnId: 'ui-turn-2', status: 'completed', unrepresentedItemTypes: [], items: [{ ...snapshot.items[0], text: '第二轮完成结果', status: 'completed', phase: 'final_answer' }] });
            notify();
          };
          notify(); resolve(snapshot.task);
        };
      });
    });
    notify(); BrowserWindow.getAllWindows()[0].webContents.send('agentx:model-settings-changed');
    return { taskId, projectId: project.projectId, threadId: 'continue-ui-thread', operationId };
  }, path.resolve('.'));
}

test('nextTurn UI：Enter 在原会话显式发起新轮，旧历史与新执行同时可见，完成后读取两轮', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const binding = await seed(app);
  await page.getByRole('button', { name: '同会话继续工作', exact: true }).click();
  await page.getByText('第一轮历史结果', { exact: true }).waitFor();
  const draft = page.getByRole('textbox', { name: '任务要求' }); await draft.fill('在原会话继续修复');
  await page.getByText('草稿已保存', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), false);
  await draft.press('Enter');
  await page.waitForFunction(() => document.querySelector('[aria-label="发送"]').disabled);
  const [request] = await app.evaluate(() => globalThis.continueRequests);
  assert.equal(request.taskId, binding.taskId); assert.equal(request.threadId, binding.threadId);
  assert.equal(request.expectedTurnId, 'ui-turn-1'); assert.equal(request.configRevision, 4);
  assert.equal(request.modelId, 'deepseek-v4-flash'); assert.notEqual(request.operationId, binding.operationId);
  await app.evaluate(() => globalThis.finishContinuation());
  await page.getByRole('button', { name: '停止', exact: true }).waitFor();
  await page.getByText('正在执行第二轮', { exact: true }).waitFor();
  assert.equal(await page.getByText('第一轮历史结果', { exact: true }).count(), 1);
  const continuous = await page.evaluate(() => {
    const scrollParent = element => {
      for (let parent = element?.parentElement; parent; parent = parent.parentElement) {
        if (['auto', 'scroll'].includes(getComputedStyle(parent).overflowY)) return parent;
      }
    };
    const history = document.querySelector('[aria-label="会话历史"]');
    const current = [...document.querySelectorAll('.execution-message')].find(element => element.textContent === '正在执行第二轮');
    return scrollParent(history) === scrollParent(current);
  });
  assert.equal(continuous, true, '旧轮与当前轮应在同一连续工作记录区滚动');
  assert.equal(await draft.inputValue(), '');
  for (const [theme, label] of [['light', '浅色'], ['dark', '深色']]) {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await page.getByRole('button', { name: '返回工作台', exact: true }).click();
    assert.equal(await app.evaluate(() => globalThis.continueRequests.length), 1);
    await page.screenshot({ path: path.resolve(`.local-validation/m1-05/continue-${theme}.png`) });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
  await page.waitForFunction(() => innerWidth === 960);
  assert.equal(await page.getByRole('button', { name: '停止', exact: true }).isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('.workspace').scrollHeight <= document.querySelector('.workspace').clientHeight + 1), true);
  await page.screenshot({ path: path.resolve('.local-validation/m1-05/continue-compact.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 820));
  await page.waitForFunction(() => innerWidth === 1280);
  await app.evaluate(() => globalThis.completeContinuation());
  await page.getByText('第二轮完成结果', { exact: true }).waitFor();
  assert.equal(await page.getByText('第一轮历史结果', { exact: true }).count(), 1);
  assert.equal((await page.evaluate(() => window.agentx.getWorkspace())).tasks.length, 1);
  await page.reload(); await page.getByRole('button', { name: '同会话继续工作', exact: true }).click();
  await page.getByText('第二轮完成结果', { exact: true }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.continueRequests.length), 1);
});

for (const navigateAway of [false, true]) test(`nextTurn UI：准备失败保留草稿，${navigateAway ? '切走再回不接受迟到导航' : '成功的新轮清理旧错误但保留提交期间的新输入'}`, { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  await seed(app); await page.getByRole('button', { name: '同会话继续工作', exact: true }).click();
  await page.getByText('第一轮历史结果', { exact: true }).waitFor();
  const draft = page.getByRole('textbox', { name: '任务要求' });
  await draft.fill('继续修改'); await page.waitForFunction(() => !document.querySelector('[aria-label="发送"]').disabled);
  await app.evaluate(() => { globalThis.failContinue = true; }); await draft.press('Enter');
  await page.getByRole('alert').filter({ hasText: '合成新配置准备失败' }).waitFor();
  assert.equal(await draft.inputValue(), '继续修改');
  await draft.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await draft.press('Control+Enter');
  assert.equal(await draft.inputValue(), '继续修改\n');
  assert.equal(await app.evaluate(() => globalThis.continueRequests.length), 1);
  await app.evaluate(() => { globalThis.failContinue = false; });
  await page.waitForFunction(() => !document.querySelector('[aria-label="发送"]').disabled); await draft.press('Enter');
  await page.waitForFunction(() => document.querySelector('[aria-label="发送"]').disabled);
  await draft.fill('提交期间的新输入');
  if (navigateAway) { await page.getByRole('button', { name: '新会话', exact: true }).click(); await draft.fill('另一个输入现场'); }
  await app.evaluate(() => globalThis.finishContinuation());
  await page.getByRole('button', { name: navigateAway ? '查看活动或待核对任务' : '停止', exact: true }).waitFor();
  assert.equal(await page.getByRole('alert').filter({ hasText: '合成新配置准备失败' }).count(), 0);
  assert.equal(await draft.inputValue(), navigateAway ? '另一个输入现场' : '提交期间的新输入');
  if (navigateAway) {
    await page.getByRole('button', { name: '同会话继续工作', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="停止"]'));
    assert.equal(await draft.inputValue(), '提交期间的新输入');
  }
  await app.evaluate(() => globalThis.completeContinuation());
});

test('nextTurn IPC：真实 Main 拒绝缺失绑定、任意路径和不存在会话，不能用续轮创建新任务', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const request = { taskId: '00000000-0000-4000-8000-000000000001', operationId: '00000000-0000-4000-8000-000000000002',
    projectId: '00000000-0000-4000-8000-000000000003', modelId: 'deepseek-v4-flash', configRevision: 0,
    text: '不应该被发送', threadId: 'missing-thread', expectedTurnId: 'missing-turn' };
  for (const invalid of [null, [], { ...request, cwd: 'C:\\Windows' }, { ...request, modelId: 'other' }, request]) {
    await assert.rejects(page.evaluate(value => window.agentx.continueExecution(value), invalid), /无效|变化|结束/);
  }
  assert.equal((await page.evaluate(() => window.agentx.getWorkspace())).tasks.length, 0);
  assert.equal((await page.evaluate(() => window.agentx.getExecution())).task, null);
});
