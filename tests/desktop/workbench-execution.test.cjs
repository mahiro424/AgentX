const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch, crashTestApp } = require('./helpers.cjs');

async function assertComposerInViewport(page) {
  const bounds = await page.evaluate(() => {
    document.querySelector('.workspace').scrollTop = 0;
    const composer = document.querySelector('.composer').getBoundingClientRect();
    const stop = document.querySelector('button[aria-label="停止"]').getBoundingClientRect();
    return { height: innerHeight, composerTop: composer.top, composerBottom: composer.bottom, stopTop: stop.top, stopBottom: stop.bottom };
  });
  assert.ok(bounds.composerTop >= 0 && bounds.composerBottom <= bounds.height && bounds.stopTop >= 0 && bounds.stopBottom <= bounds.height,
    `输入框与停止按钮应无需页面滚动即可操作：${JSON.stringify(bounds)}`);
}

test('reconciling 与 staleApproval：断线后旧审批不可操作，页面往返保留草稿且不自动执行', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => crashTestApp(app));
  await app.evaluate(({ app, ipcMain, BrowserWindow }, repository) => {
    const req = process.getBuiltinModule('node:module').createRequire(repository + '/package.json');
    req('ts-node').register({ transpileOnly: true, project: repository + '/tsconfig.json' });
    const root = app.getPath('userData'), uuid = process.getBuiltinModule('node:crypto').randomUUID;
    const project = req(repository + '/src/main/storage/projects.ts').associateProject(root, root).project;
    const now = new Date().toISOString();
    const task = { taskId: uuid(), projectId: project.projectId, directory: root, title: '合成断线任务',
      lastActivityAt: now, observedAt: now, executionState: 'waitingApproval', threadId: 'thread-lost', turnId: 'turn-lost' };
    req(repository + '/src/main/storage/tasks.ts').createTaskRecord(root, task);
    const snapshot = { preparing: false, task, operationId: uuid(), error: null, items: [], approvals: [{
      approvalToken: uuid(), itemId: 'approval-lost', threadId: task.threadId, turnId: task.turnId,
      kind: 'command', status: 'pending', startedAtMs: 1, command: 'node synthetic.cjs', cwd: root,
      reason: '合成断线审批', environmentId: null, network: null, grantRoot: null,
    }] };
    globalThis.unexpectedExecutionCalls = [];
    for (const action of ['start', 'steer', 'stop', 'approval']) {
      ipcMain.removeHandler('agentx:execution-' + action);
      ipcMain.handle('agentx:execution-' + action, () => { globalThis.unexpectedExecutionCalls.push(action); throw new Error('不应自动发出控制请求'); });
    }
    ipcMain.removeHandler('agentx:execution-read'); ipcMain.handle('agentx:execution-read', () => snapshot);
    globalThis.disconnectApprovalFixture = () => {
      snapshot.task.executionState = 'reconciling'; snapshot.error = '合成连接断开，请核对状态';
      snapshot.approvals[0].status = 'stale';
      BrowserWindow.getAllWindows()[0].webContents.send('agentx:execution-changed');
    };
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed');
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:execution-changed');
  }, path.resolve('.'));
  await page.getByRole('button', { name: '合成断线任务', exact: true }).click();
  const card = page.getByRole('group', { name: '审批请求：approval-lost', exact: true });
  await card.getByText('等待你批准', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: '任务要求' }).fill('断线后保留的中文草稿');
  await app.evaluate(() => globalThis.disconnectApprovalFixture());
  await card.getByText('请求已失效', { exact: true }).waitFor();
  assert.equal(await card.getByRole('button', { name: '允许本次', exact: true }).isDisabled(), true);
  assert.equal(await card.getByRole('button', { name: '拒绝', exact: true }).isDisabled(), true);
  await page.getByRole('alert').filter({ hasText: '合成连接断开' }).waitFor();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await card.getByText('请求已失效', { exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '任务要求' }).inputValue(), '断线后保留的中文草稿');
  await page.getByRole('textbox', { name: '任务要求' }).press('Control+Enter');
  await page.getByRole('textbox', { name: '任务要求' }).press('Enter');
  await page.screenshot({ path: path.resolve('.local-validation/m1-04/106-reconciling-stale.png') });
  assert.deepEqual(await app.evaluate(() => globalThis.unexpectedExecutionCalls), []);
});

test('running：真实工作台显示执行项，输入主按钮切换为停止，停止应答不伪装终态', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => crashTestApp(app));
  await app.evaluate(({ app, ipcMain, BrowserWindow }, repository) => {
    const req = process.getBuiltinModule('node:module').createRequire(repository + '/package.json');
    req('ts-node').register({ transpileOnly: true, project: repository + '/tsconfig.json' });
    const root = app.getPath('userData'), uuid = process.getBuiltinModule('node:crypto').randomUUID;
    const project = req(repository + '/src/main/storage/projects.ts').associateProject(root, root).project;
    const now = new Date().toISOString();
    const task = { taskId: uuid(), projectId: project.projectId, directory: root, title: '合成工作台任务',
      lastActivityAt: now, observedAt: now, executionState: 'running', threadId: 'thread-ui', turnId: 'turn-ui' };
    req(repository + '/src/main/storage/tasks.ts').createTaskRecord(root, task);
    const snapshot = { preparing: false, task, operationId: uuid(), error: null, approvals: [], items: [
      { kind: 'message', threadId: task.threadId, turnId: task.turnId, itemId: 'text', text: '正在检查合成项目', phase: 'commentary', status: 'completed' },
      { kind: 'command', threadId: task.threadId, turnId: task.turnId, itemId: 'command', command: 'npm test', directory: root, output: '断言失败', exitCode: 1, durationMs: 10, status: 'failed' },
    ] };
    let deferRead = false, readEntered;
    globalThis.showPlanFixture = () => {
      snapshot.plan = { threadId: task.threadId, turnId: task.turnId, explanation: null,
        plan: [{ step: '合成计划：检查文件', status: 'inProgress' }, { step: '合成计划：验证修复', status: 'pending' }] };
      BrowserWindow.getAllWindows()[0].webContents.send('agentx:execution-changed');
    };
    globalThis.executionReadEntered = new Promise(resolve => { readEntered = resolve; });
    ipcMain.removeHandler('agentx:execution-read'); ipcMain.handle('agentx:execution-read', () => deferRead ? new Promise(resolve => {
      globalThis.releaseExecutionRead = () => { deferRead = false; resolve(snapshot); }; readEntered();
    }) : snapshot);
    ipcMain.removeHandler('agentx:execution-stop'); ipcMain.handle('agentx:execution-stop', (_event, request) => {
      if (request.taskId !== task.taskId || request.threadId !== task.threadId || request.turnId !== task.turnId) throw new Error('UI 关联错误');
      snapshot.task.executionState = 'stopping'; deferRead = true;
    });
    globalThis.failStopFixture = () => {
      snapshot.task.executionState = 'running';
      ipcMain.removeHandler('agentx:execution-stop'); ipcMain.handle('agentx:execution-stop', () => { throw new Error('合成停止失败'); });
      BrowserWindow.getAllWindows()[0].webContents.send('agentx:execution-changed');
    };
    let steerCount = 0;
    ipcMain.removeHandler('agentx:execution-steer'); ipcMain.handle('agentx:execution-steer', (_event, request) => {
      if (request.taskId !== task.taskId || request.turnId !== task.turnId) throw new Error('补充归属错误');
      if (++steerCount === 1) throw new Error('合成补充失败');
      return new Promise(resolve => { globalThis.finishSteerFixture = resolve; });
    });
    globalThis.showApprovalsFixture = () => {
      snapshot.task.executionState = 'waitingApproval';
      snapshot.approvals = ['approval-1', 'approval-2'].map((itemId, index) => ({ approvalToken: uuid(), itemId,
        threadId: task.threadId, turnId: task.turnId, kind: 'command', status: 'pending', startedAtMs: 1,
        command: index ? 'npm run build' : 'npm test', cwd: root, reason: '合成审批范围', environmentId: null, network: null, grantRoot: null }));
      BrowserWindow.getAllWindows()[0].webContents.send('agentx:execution-changed');
    };
    ipcMain.removeHandler('agentx:execution-approval'); ipcMain.handle('agentx:execution-approval', (_event, request) => {
      const approval = snapshot.approvals.find(value => value.approvalToken === request.approvalToken);
      if (!approval || approval.status !== 'pending' || !['accept', 'decline'].includes(request.decision)) throw new Error('审批关联错误');
      approval.status = 'resolved';
      if (snapshot.approvals.every(value => value.status === 'resolved')) snapshot.task.executionState = 'running';
      BrowserWindow.getAllWindows()[0].webContents.send('agentx:execution-changed');
    });
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed');
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:execution-changed');
  }, path.resolve('.'));
  await page.getByRole('button', { name: '合成工作台任务', exact: true }).click();
  await page.getByText('正在检查合成项目', { exact: true }).waitFor();
  assert.equal(await page.getByRole('group', { name: '引擎计划', exact: true }).count(), 0);
  await app.evaluate(() => globalThis.showPlanFixture());
  await page.getByText('合成计划：检查文件', { exact: true }).waitFor();
  await page.getByText('合成计划：验证修复', { exact: true }).waitFor();
  await assertComposerInViewport(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '模型连接', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '新配置仅对下一轮生效' }).waitFor();
  await page.getByRole('switch', { name: '启用 DeepSeek' }).click();
  await page.getByRole('status').filter({ hasText: '不会停止当前轮' }).waitFor();
  assert.equal((await page.evaluate(() => window.agentx.getExecution())).task.executionState, 'running');
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await page.getByText('npm test', { exact: true }).click();
  await page.getByText('断言失败', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '发送', exact: true }).count(), 0);
  await page.getByRole('textbox', { name: '任务要求' }).fill('保留这段补充草稿');
  await app.evaluate(() => globalThis.showApprovalsFixture());
  const firstApproval = page.getByRole('group', { name: '审批请求：approval-1', exact: true });
  const secondApproval = page.getByRole('group', { name: '审批请求：approval-2', exact: true });
  await firstApproval.getByRole('button', { name: '允许本次', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.resolve('.local-validation/m1-04/72-approval-light.png') });
  await firstApproval.getByRole('button', { name: '允许本次', exact: true }).click();
  assert.equal(await firstApproval.getByRole('button', { name: '允许本次', exact: true }).isDisabled(), true);
  assert.equal(await secondApproval.getByRole('button', { name: '拒绝', exact: true }).isEnabled(), true);
  await secondApproval.getByRole('button', { name: '拒绝', exact: true }).click();
  await page.getByRole('textbox', { name: '任务要求' }).press('Control+Enter');
  assert.equal(await page.getByRole('textbox', { name: '任务要求' }).inputValue(), '保留这段补充草稿\n');
  assert.equal(await page.getByRole('button', { name: '停止', exact: true }).isEnabled(), true);
  await page.getByRole('textbox', { name: '任务要求' }).fill('保留这段补充草稿');
  // 键盘发送不会像点击按钮那样等待可用；先满足产品的草稿修订落盘前置条件。
  await page.getByRole('status').filter({ hasText: '草稿已保存' }).waitFor();
  await page.getByRole('textbox', { name: '任务要求' }).press('Enter');
  await page.getByRole('alert').filter({ hasText: '合成补充失败' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '任务要求' }).inputValue(), '保留这段补充草稿');
  await page.getByRole('button', { name: '补充要求', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '停止', exact: true }).isEnabled(), true);
  await page.getByRole('textbox', { name: '任务要求' }).fill('发送期间的新草稿');
  await app.evaluate(() => globalThis.finishSteerFixture());
  await page.getByText('补充要求已接收', { exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '任务要求' }).inputValue(), '发送期间的新草稿');
  await page.getByRole('textbox', { name: '任务要求' }).fill('保留这段补充草稿');
  await page.screenshot({ path: path.resolve('.local-validation/m1-04/66-running-light.png') });
  await page.evaluate(() => window.agentx.savePreferences({ theme: 'dark', zoom: 1 }));
  await page.waitForFunction(() => matchMedia('(prefers-color-scheme: dark)').matches);
  await page.screenshot({ path: path.resolve('.local-validation/m1-04/66-running-dark.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
  await page.waitForFunction(() => innerWidth === 960);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await assertComposerInViewport(page);
  await page.screenshot({ path: path.resolve('.local-validation/m1-04/66-running-compact.png') });
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await app.evaluate(() => globalThis.executionReadEntered);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.getByRole('button', { name: '停止', exact: true }).isDisabled(), true);
  await app.evaluate(() => globalThis.releaseExecutionRead());
  await page.getByText('正在停止，等待引擎确认…', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '停止', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('textbox', { name: '任务要求' }).inputValue(), '保留这段补充草稿');
  await app.evaluate(() => globalThis.failStopFixture());
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '合成停止失败' }).waitFor();
  await page.getByRole('button', { name: '新会话', exact: true }).click();
  assert.equal(await page.getByRole('alert').filter({ hasText: '合成停止失败' }).count(), 0);
});
