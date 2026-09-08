const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { launch, crashTestApp } = require('./helpers.cjs');
require('ts-node').register({ transpileOnly: true });

test('状态诊断：已知与未知分别展示，失败保留草稿，核对不会重发或清锁', { timeout: 45000 }, async t => {
  const { app, page, data } = await launch(); t.after(() => crashTestApp(app));
  const project = require('../../src/main/storage/projects.ts').associateProject(data, data).project;
  const taskId = randomUUID(), now = new Date().toISOString();
  require('../../src/main/storage/tasks.ts').createTaskRecord(data, { taskId, projectId: project.projectId, directory: data,
    title: '需要诊断的合成会话', executionState: 'reconciling', threadId: null, turnId: null, lastActivityAt: now, observedAt: now });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed'));
  await page.getByRole('button', { name: '需要诊断的合成会话', exact: true }).click();
  await page.getByRole('textbox', { name: '任务要求' }).fill('核对后仍保留这份输入');
  assert.equal(await page.getByRole('button', { name: '查看诊断', exact: true }).count(), 1);
  await page.getByRole('button', { name: '查看诊断', exact: true }).click();
  const details = page.getByRole('region', { name: '状态核对详情' });
  await details.getByText('没有已确认的会话关联，不能猜测历史归属或重新发送原要求。', { exact: true }).waitFor();
  await details.getByText('没有进程归属记录，不能确认是否存在遗留执行。', { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.agentx.getWorkspace())).tasks[0].executionState, 'reconciling');
  assert.equal(await page.getByRole('textbox', { name: '任务要求' }).inputValue(), '核对后仍保留这份输入');
  assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);
  for (const value of [null, [], { taskId, path: 'C:\\Windows' }, { taskId, method: 'turn/start' }]) {
    await assert.rejects(page.evaluate(value => window.agentx.getReconciliation(value), value), /请求无效/);
  }
  const files = await require('node:fs/promises').readdir(data);
  assert.equal(files.includes('engine'), false);
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('agentx:reconciliation-read');
    ipcMain.handle('agentx:reconciliation-read', () => { throw new Error('合成产品记录读取失败'); });
  });
  await page.getByRole('button', { name: '重新核对', exact: true }).click();
  await details.getByRole('alert').filter({ hasText: '合成产品记录读取失败' }).waitFor();
  await details.getByText('以下保留上次核对事实，不代表当前状态。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '任务要求' }).inputValue(), '核对后仍保留这份输入');
});

test('孤立引擎记录：切换到其他会话也能核对，不依赖侧栏中存在原任务', { timeout: 45000 }, async t => {
  const fs = require('node:fs/promises');
  await fs.mkdir(path.resolve('.local-validation/m1-06'), { recursive: true });
  const data = await fs.mkdtemp(path.resolve('.local-validation/m1-06/orphan-ui-'));
  const project = require('../../src/main/storage/projects.ts').associateProject(data, data).project;
  const taskId = randomUUID(), orphanId = randomUUID(), now = new Date().toISOString();
  require('../../src/main/storage/tasks.ts').createTaskRecord(data, { taskId, projectId: project.projectId, directory: data,
    title: '另一个未开始的会话', executionState: 'idle', threadId: null, turnId: null, lastActivityAt: now, observedAt: now });
  const leases = require('../../src/main/storage/runtime-leases.ts');
  leases.acquireRuntimeLease(data, { leaseId: randomUUID(), instanceId: randomUUID(), taskId: orphanId,
    operationId: randomUUID(), projectId: project.projectId, createdAt: now,
    identity: { pid: process.pid, parentPid: process.ppid, createdAt: '2020-01-01T00:00:00.000Z', executablePath: process.execPath } });
  const { app, page } = await launch(data); t.after(() => crashTestApp(app));
  await app.evaluate(() => {
    const childProcess = process.getBuiltinModule('node:child_process');
    const original = childProcess.execFile;
    childProcess.execFile = function (file, args, options, callback) {
      const encoded = args?.indexOf('-EncodedCommand');
      const script = encoded >= 0 ? Buffer.from(args[encoded + 1], 'base64').toString('utf16le') : '';
      if (!script.includes('Get-CimInstance -ClassName Win32_Process')) return original.call(this, file, args, options, callback);
      const started = Date.now();
      return original.call(this, file, args, options, (...result) => {
        // 合成测试仅延后本实例只读进程查询的应答，不伪造 PID 身份或跳过真实系统查询。
        setTimeout(() => callback(...result), Math.max(0, 6000 - (Date.now() - started)));
      });
    };
  });
  await page.getByRole('button', { name: '另一个未开始的会话', exact: true }).click();
  await page.getByRole('textbox', { name: '任务要求' }).fill('这是另一份草稿，不属于待核对记录');
  assert.equal(await page.getByRole('button', { name: '查看诊断', exact: true }).count(), 1);
  await page.getByRole('button', { name: '查看诊断', exact: true }).click();
  const details = page.getByRole('region', { name: '状态核对详情' });
  await details.getByRole('status').filter({ hasText: '正在读取发送意图、进程身份和公开历史' }).waitFor();
  assert.equal(await details.getByRole('button', { name: '重新核对', exact: true }).isDisabled(), true);
  // 真实 Windows 身份查询有 10 秒期限，不能用普通控件的 5 秒等待抢先判失败。
  const started = Date.now();
  await details.getByText('核对对象：尚未完成派发的准备记录', { exact: true }).waitFor({ timeout: 15000 });
  t.diagnostic(`只读系统进程核对响应等待：${Date.now() - started} ms`);
  await details.getByText('该 PID 已属于其他进程，不会操作它', { exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '任务要求' }).inputValue(), '这是另一份草稿，不属于待核对记录');
  assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);
  assert.equal((await page.evaluate(() => window.agentx.getWorkspace())).tasks.length, 1);
  assert.equal(leases.readRuntimeLeases(data)[0].releasedAt, null);
  assert.equal((await fs.readdir(data)).includes('engine'), false);
});

test('核对响应：切换会话不接收旧结果，归属错误或过期事实保持可见', { timeout: 45000 }, async t => {
  const { app, page, data } = await launch(); t.after(() => crashTestApp(app));
  const project = require('../../src/main/storage/projects.ts').associateProject(data, data).project;
  const firstId = randomUUID(), secondId = randomUUID(), now = new Date().toISOString();
  for (const [taskId, title] of [[firstId, '第一个待核对会话'], [secondId, '第二个待核对会话']]) {
    require('../../src/main/storage/tasks.ts').createTaskRecord(data, { taskId, projectId: project.projectId, directory: data,
      title, executionState: 'reconciling', threadId: null, turnId: null, lastActivityAt: now, observedAt: now });
  }
  await app.evaluate(({ ipcMain, BrowserWindow }, { firstId }) => {
    ipcMain.removeHandler('agentx:reconciliation-read');
    globalThis.diagnosticCalls = [];
    ipcMain.handle('agentx:reconciliation-read', async (_event, { taskId }) => {
      globalThis.diagnosticCalls.push(taskId);
      if (taskId === firstId) await new Promise(resolve => { globalThis.finishOldDiagnostic = resolve; });
      return { taskId, title: taskId === firstId ? '不应串入的新旧边界' : '第二个会话的核对事实', observedAt: new Date().toISOString(),
        stale: true, intents: [], processes: [], history: null, historyError: '合成公开历史读取失败', bindingIssue: null, matchedTurnStatus: null };
    });
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed');
  }, { firstId });
  await page.getByRole('button', { name: '第一个待核对会话', exact: true }).click();
  await page.getByRole('button', { name: '查看诊断', exact: true }).click();
  await page.getByRole('button', { name: '重新核对', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '重新核对', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '第二个待核对会话', exact: true }).click();
  await page.getByRole('button', { name: '查看诊断', exact: true }).click();
  await page.getByText('核对对象：第二个会话的核对事实', { exact: true }).waitFor();
  await app.evaluate(() => globalThis.finishOldDiagnostic());
  await page.getByText('读取期间产品记录已变化，请重新核对；本次结果不是最新状态。', { exact: true }).waitFor();
  assert.equal(await page.getByText('核对对象：不应串入的新旧边界', { exact: true }).count(), 0);
  assert.deepEqual(await app.evaluate(() => globalThis.diagnosticCalls), [firstId, secondId]);
  await app.evaluate(({ ipcMain }, firstId) => {
    ipcMain.removeHandler('agentx:reconciliation-read');
    ipcMain.handle('agentx:reconciliation-read', () => ({ taskId: firstId }));
  }, firstId);
  await page.getByRole('button', { name: '重新核对', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '核对结果归属不一致' }).waitFor();
  assert.equal(await page.getByText('核对对象：第二个会话的核对事实', { exact: true }).count(), 1);
});
