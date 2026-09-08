const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch } = require('./helpers.cjs');

async function seed(app, command = {}, live = false) {
  return app.evaluate(({ app, BrowserWindow, ipcMain }, { repository, command, live }) => {
    const req = process.getBuiltinModule('node:module').createRequire(repository + '/package.json');
    req('ts-node').register({ transpileOnly: true, project: repository + '/tsconfig.json' });
    const root = app.getPath('userData'), now = new Date().toISOString();
    const project = req(repository + '/src/main/storage/projects.ts').associateProject(root, root).project;
    const taskId = process.getBuiltinModule('node:crypto').randomUUID();
    const task = { taskId, projectId: project.projectId, directory: root,
      title: '检查命令输出', executionState: live ? 'running' : 'failed', threadId: 'output-thread', turnId: 'output-turn', lastActivityAt: now, observedAt: now };
    req(repository + '/src/main/storage/tasks.ts').createTaskRecord(root, task);
    const item = { kind: 'command', threadId: 'output-thread', turnId: 'output-turn', itemId: 'command-1', command: 'node --test',
      directory: root, output: 'FAIL export.test.cjs\n期望：export.csv\n实际：.csv\n', exitCode: 1, durationMs: 342, status: 'failed', ...command };
    ipcMain.removeHandler('agentx:task-history-read');
    ipcMain.handle('agentx:task-history-read', () => ({ taskId, threadId: 'output-thread', turns: [{
      turnId: 'output-turn', status: 'failed', items: [item], unrepresentedItemTypes: [],
    }] }));
    if (live) {
      const snapshot = { preparing: false, task, operationId: process.getBuiltinModule('node:crypto').randomUUID(), error: null, items: [item], approvals: [] };
      ipcMain.removeHandler('agentx:execution-read'); ipcMain.handle('agentx:execution-read', () => snapshot);
      globalThis.changeOutputFixture = value => {
        Object.assign(item, value); BrowserWindow.getAllWindows()[0].webContents.send('agentx:execution-changed');
      };
      BrowserWindow.getAllWindows()[0].webContents.send('agentx:execution-changed');
    }
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed');
    return { taskId, item };
  }, { repository: path.resolve('.'), command, live });
}

test('commandOutput：命令详情打开只读侧面板，保留真实输出、退出码和轮次归属', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const { item } = await seed(app);
  await page.getByRole('button', { name: '检查命令输出', exact: true }).click();
  await page.getByRole('textbox', { name: '任务要求' }).fill('请修复这个失败用例');
  await page.locator('summary').filter({ hasText: 'node --test' }).click();
  assert.equal(await page.getByRole('button', { name: '查看执行输出' }).count(), 1);
  await page.getByRole('button', { name: '查看执行输出' }).click();
  const panel = page.getByRole('region', { name: '执行输出' });
  assert.match(await panel.innerText(), /退出码：1/);
  assert.match(await panel.innerText(), /output-turn/);
  assert.match(await panel.innerText(), /只读记录/);
  assert.equal(await panel.locator('pre').textContent(), item.output);
  assert.equal(await panel.locator('textarea,input:not([type=checkbox]),[contenteditable=true]').count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '关闭输出面板');
  await page.keyboard.press('Escape');
  assert.equal(await panel.count(), 0);
  assert.equal(await page.getByRole('textbox', { name: '任务要求' }).inputValue(), '请修复这个失败用例');
  assert.equal((await page.evaluate(() => window.agentx.getWorkspace())).tasks[0].executionState, 'failed');
});

test('commandOutput：输出缺失不能复制或默认为成功；结束轮内运行记录仍标未核对', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  await seed(app, { output: null, exitCode: null, durationMs: null, status: 'running' });
  await page.getByRole('button', { name: '检查命令输出', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'node --test' }).click();
  await page.getByRole('button', { name: '查看执行输出' }).click();
  const panel = page.getByRole('region', { name: '执行输出' });
  assert.match(await panel.innerText(), /退出码：尚未返回/);
  assert.match(await panel.innerText(), /最后记录：进行中（未核对）/);
  assert.doesNotMatch(await panel.innerText(), /退出码：0|命令已结束/);
  assert.equal(await panel.getByRole('button', { name: '复制输出' }).isDisabled(), true);
});

test('commandOutput：复制接口只接受有界纯文本，不暴露读取剪贴板或命令执行', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  await app.evaluate(({ clipboard }) => { globalThis.outputCopies = []; clipboard.writeText = async text => { globalThis.outputCopies.push(text); }; });
  for (const invalid of [null, [], { text: '禁止对象' }, 2, '有\0空字符', 'x'.repeat(2_000_001)]) {
    await assert.rejects(page.evaluate(value => window.agentx.copyOutput(value), invalid), /复制内容无效/);
  }
  assert.deepEqual(await app.evaluate(() => globalThis.outputCopies), []);
  assert.equal(await page.evaluate(() => typeof window.agentx.readClipboard), 'undefined');
});

test('commandOutput：当前命令持续更新，关闭面板或切换页面不发送停止', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  await seed(app, { output: '第一段\n', status: 'running', exitCode: null, durationMs: null }, true);
  await app.evaluate(({ ipcMain, clipboard }) => {
    globalThis.outputControls = []; globalThis.outputCopies = [];
    for (const action of ['start', 'stop', 'steer']) {
      ipcMain.removeHandler('agentx:execution-' + action);
      ipcMain.handle('agentx:execution-' + action, () => { globalThis.outputControls.push(action); throw new Error('查看结果不应执行控制'); });
    }
    clipboard.writeText = async text => { globalThis.outputCopies.push(text); };
  });
  await page.getByRole('button', { name: '检查命令输出', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'node --test' }).click();
  await page.getByRole('button', { name: '查看执行输出' }).click();
  const panel = page.getByRole('region', { name: '执行输出' });
  await panel.getByRole('button', { name: '复制输出' }).click();
  await page.getByText('输出已复制', { exact: true }).waitFor();
  await app.evaluate(() => globalThis.changeOutputFixture({ output: '第一段\n第二段\n' }));
  await panel.getByText('已复制点击时的输出；之后有新的输出，请按需重新复制。', { exact: true }).waitFor();
  assert.equal(await panel.locator('pre').textContent(), '第一段\n第二段\n');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '返回工作台' }).click();
  assert.equal(await panel.isVisible(), true);
  await page.getByRole('button', { name: '新会话', exact: true }).click();
  assert.equal(await panel.count(), 0);
  await page.getByRole('button', { name: '检查命令输出', exact: true }).click();
  assert.equal(await panel.isVisible(), true);
  await page.getByRole('button', { name: '关闭输出面板' }).click();
  assert.equal(await page.getByRole('button', { name: '停止', exact: true }).count(), 1);
  assert.deepEqual(await app.evaluate(() => globalThis.outputControls), []);
});

test('commandOutput 设计 QA：主题、紧凑窗口、调宽与关闭焦点', { timeout: 90000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  await seed(app);
  await page.getByRole('button', { name: '检查命令输出', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'node --test' }).click();
  await page.getByRole('button', { name: '查看执行输出' }).click();
  const panel = page.getByRole('region', { name: '执行输出' });
  const separator = panel.getByRole('separator', { name: '调整输出面板宽度' });
  await separator.focus(); await page.keyboard.press('ArrowLeft');
  assert.equal(await separator.getAttribute('aria-valuenow'), '456');
  await separator.press('ArrowRight');
  const output = path.resolve('.local-validation/m1-05');
  for (const [theme, label] of [['light', '浅色'], ['dark', '深色']]) {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await page.getByRole('button', { name: '返回工作台' }).click();
    await page.screenshot({ path: path.join(output, `output-${theme}.png`) });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
  await page.waitForFunction(() => innerWidth === 960);
  const bounds = await panel.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 960 && bounds.y + bounds.height <= 640);
  const geometry = await page.locator('.workspace').evaluate(element => ({ scroll: element.scrollHeight, client: element.clientHeight }));
  assert.ok(geometry.scroll <= geometry.client + 1, JSON.stringify(geometry));
  await page.screenshot({ path: path.join(output, 'output-compact.png') });
  await page.getByRole('button', { name: '放大输出面板' }).click();
  await page.getByRole('button', { name: '还原输出面板' }).click();
  await page.keyboard.press('Escape');
  assert.equal(await panel.count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), '查看执行输出');
});

test('commandOutput：复制只写实际输出，系统写入失败不报成功且保留草稿', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const { item } = await seed(app);
  // 只替换操作系统剪贴板写边界；真实 Main 校验与 Preload 保留，不碰用户剪贴板。
  await app.evaluate(({ clipboard }) => {
    globalThis.outputCopies = []; globalThis.failOutputCopy = true;
    clipboard.writeText = async text => {
      if (globalThis.failOutputCopy) throw new Error('合成剪贴板被占用');
      globalThis.outputCopies.push(text);
    };
  });
  await page.getByRole('button', { name: '检查命令输出', exact: true }).click();
  await page.getByRole('textbox', { name: '任务要求' }).fill('复制失败也保留输入');
  await page.locator('summary').filter({ hasText: 'node --test' }).click();
  await page.getByRole('button', { name: '查看执行输出' }).click();
  assert.equal(await page.getByRole('button', { name: '复制输出', exact: true }).count(), 1);
  await page.getByRole('button', { name: '复制输出', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '合成剪贴板被占用' }).waitFor();
  assert.equal(await page.getByText('输出已复制', { exact: true }).count(), 0);
  await app.evaluate(() => { globalThis.failOutputCopy = false; });
  await page.getByRole('button', { name: '复制输出', exact: true }).click();
  await page.getByText('输出已复制', { exact: true }).waitFor();
  assert.deepEqual(await app.evaluate(() => globalThis.outputCopies), [item.output]);
  assert.equal(await page.getByRole('textbox', { name: '任务要求' }).inputValue(), '复制失败也保留输入');
});

test('commandOutput：自动换行只改变阅读方式，不改变长输出的内容', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const output = '这是未截断的合成命令输出。'.repeat(80) + '\n第二行\n';
  await seed(app, { output });
  await page.getByRole('button', { name: '检查命令输出', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'node --test' }).click();
  await page.getByRole('button', { name: '查看执行输出' }).click();
  assert.equal(await page.getByRole('switch', { name: '自动换行' }).count(), 1);
  assert.equal(await page.getByRole('switch', { name: '自动换行' }).isChecked(), true);
  const pre = page.getByRole('region', { name: '执行输出' }).locator('pre');
  await page.getByRole('switch', { name: '自动换行' }).click();
  assert.equal(await pre.evaluate(element => getComputedStyle(element).whiteSpace), 'pre');
  assert.equal(await pre.textContent(), output);
  await page.getByRole('switch', { name: '自动换行' }).click();
  assert.equal(await pre.evaluate(element => getComputedStyle(element).whiteSpace), 'pre-wrap');
});
