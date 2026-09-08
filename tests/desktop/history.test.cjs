const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch } = require('./helpers.cjs');

async function seed(app) {
  return app.evaluate(({ app, BrowserWindow, ipcMain }, repository) => {
    const req = process.getBuiltinModule('node:module').createRequire(repository + '/package.json');
    req('ts-node').register({ transpileOnly: true, project: repository + '/tsconfig.json' });
    const root = app.getPath('userData'), now = new Date().toISOString();
    const project = req(repository + '/src/main/storage/projects.ts').associateProject(root, root).project;
    const taskId = process.getBuiltinModule('node:crypto').randomUUID();
    req(repository + '/src/main/storage/tasks.ts').createTaskRecord(root, { taskId, projectId: project.projectId, directory: root,
      title: '历史检查会话', executionState: 'completed', threadId: 'history-thread', turnId: 'history-turn', lastActivityAt: now, observedAt: now });
    globalThis.historyRequests = [];
    ipcMain.removeHandler('agentx:task-history-read');
    ipcMain.handle('agentx:task-history-read', (_event, value) => {
      globalThis.historyRequests.push(value);
      return new Promise((resolve, reject) => { globalThis.resolveHistory = resolve; globalThis.rejectHistory = reject; });
    });
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed');
    return { taskId, projectId: project.projectId };
  }, path.resolve('.'));
}

test('loadingHistory：选择已结束会话显示读取中，不将加载伪装为空历史', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const { taskId } = await seed(app);
  await page.getByRole('button', { name: '历史检查会话', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '正在读取会话历史' }).waitFor();
  assert.deepEqual(await app.evaluate(() => globalThis.historyRequests), [{ taskId }]);
  assert.equal(await page.getByText('尚无历史').count(), 0);
  await page.getByRole('textbox', { name: '任务要求' }).fill('加载期间保留草稿');
  await page.getByRole('button', { name: '新会话', exact: true }).click();
  assert.equal(await page.getByRole('status').filter({ hasText: '正在读取会话历史' }).count(), 0);
});


test('historyReady：展示用户要求与真实命令结果，历史只读且不显示隐藏推理', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const { taskId } = await seed(app);
  await page.getByRole('button', { name: '历史检查会话', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '正在读取会话历史' }).waitFor();
  await app.evaluate((_electron, taskId) => globalThis.resolveHistory({ taskId, threadId: 'history-thread', turns: [{
    turnId: 'history-turn', status: 'completed', unrepresentedItemTypes: ['reasoning'], items: [
      { kind: 'userMessage', threadId: 'history-thread', turnId: 'history-turn', itemId: 'user-1', text: '修复合成代码项目' },
      { kind: 'command', threadId: 'history-thread', turnId: 'history-turn', itemId: 'command-1', command: 'node --test',
        directory: 'C:\\synthetic', output: '合成测试失败输出', exitCode: 1, durationMs: 12, status: 'failed' },
      { kind: 'message', threadId: 'history-thread', turnId: 'history-turn', itemId: 'message-1', text: '历史最终结果', phase: 'final_answer', status: 'completed' },
    ],
  }] }), taskId);
  await page.getByText('历史最终结果', { exact: true }).waitFor();
  assert.equal(await page.getByText('修复合成代码项目', { exact: true }).count(), 1);
  await page.locator('summary').filter({ hasText: 'node --test' }).click();
  await page.getByText('合成测试失败输出', { exact: true }).waitFor();
  assert.match(await page.getByLabel('会话历史').innerText(), /退出码：1/);
  assert.equal(await page.getByRole('status').filter({ hasText: '正在读取会话历史' }).count(), 0);
  assert.equal(await page.getByText('reasoning', { exact: true }).count(), 0);
  assert.deepEqual(await app.evaluate(() => globalThis.historyRequests), [{ taskId }]);
});


test('historyUnavailable：错误可见、保留草稿，可明确重读而不自动重发任务', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const { taskId } = await seed(app);
  await page.getByRole('button', { name: '历史检查会话', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '正在读取会话历史' }).waitFor();
  await page.getByRole('textbox', { name: '任务要求' }).fill('历史失败时保留我的输入');
  await app.evaluate(() => globalThis.rejectHistory(new Error('合成历史不可读取')));
  await page.getByRole('alert').filter({ hasText: '合成历史不可读取' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '任务要求' }).inputValue(), '历史失败时保留我的输入');
  assert.equal(await page.getByLabel('会话历史').count(), 0);
  await page.getByRole('button', { name: '重新读取历史', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '正在读取会话历史' }).waitFor();
  await app.evaluate((_electron, taskId) => globalThis.resolveHistory({ taskId, threadId: 'history-thread', turns: [{
    turnId: 'history-turn', status: 'completed', unrepresentedItemTypes: [], items: [
      { kind: 'message', threadId: 'history-thread', turnId: 'history-turn', itemId: 'message-1', text: '重读后的实际记录', phase: 'final_answer', status: 'completed' },
    ],
  }] }), taskId);
  await page.getByText('重读后的实际记录', { exact: true }).waitFor();
  assert.equal(await page.getByRole('alert').filter({ hasText: '合成历史不可读取' }).count(), 0);
  assert.deepEqual(await app.evaluate(() => globalThis.historyRequests), [{ taskId }, { taskId }]);
});


test('历史 IPC：真实 Main 拒绝任意路径/RPC 与不存在任务，不暴露通用读取', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const taskId = '00000000-0000-4000-8000-000000000001';
  for (const value of [null, [], { taskId, path: 'C:\\Windows' }, { taskId, threadId: 'foreign' }, { taskId, method: 'turn/start' }]) {
    await assert.rejects(page.evaluate(value => window.agentx.getTaskHistory(value), value), /历史读取请求无效/);
  }
  await assert.rejects(page.evaluate(taskId => window.agentx.getTaskHistory({ taskId }), taskId), /任务不存在/);
  assert.equal((await page.evaluate(() => window.agentx.getExecution())).task, null);
});


test('历史导航焦点：迟到的输入框聚焦不抢走用户已移到项目操作的焦点', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  await seed(app);
  await page.getByRole('button', { name: '历史检查会话', exact: true }).waitFor();
  const kept = await page.evaluate(() => {
    const original = window.requestAnimationFrame, callbacks = [];
    window.requestAnimationFrame = callback => { callbacks.push(callback); return callbacks.length; };
    try {
      document.querySelector('[aria-label="历史检查会话"]').click();
      const button = document.querySelector('.project-actions [aria-haspopup="menu"]');
      button.focus();
      for (const callback of callbacks) callback(performance.now());
      return document.activeElement === button;
    } finally { window.requestAnimationFrame = original; }
  });
  assert.equal(kept, true);
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: '编辑名称' }).waitFor();
});
