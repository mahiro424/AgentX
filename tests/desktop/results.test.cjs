const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch } = require('./helpers.cjs');

async function seed(app, state = 'completed') {
  return app.evaluate(async ({ app, BrowserWindow, ipcMain }, { repository, state }) => {
    const req = process.getBuiltinModule('node:module').createRequire(repository + '/package.json');
    req('ts-node').register({ transpileOnly: true, project: repository + '/tsconfig.json' });
    const fs = process.getBuiltinModule('node:fs/promises'), path = process.getBuiltinModule('node:path');
    const root = app.getPath('userData'), directory = path.join(root, 'project'); await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'source.txt'), '第一行\n原始内容\n');
    await fs.writeFile(path.join(directory, 'manual.txt'), '本轮开始前人工留下的内容');
    const project = req(repository + '/src/main/storage/projects.ts').associateProject(root, directory).project;
    const tasks = req(repository + '/src/main/storage/tasks.ts');
    const scan = req(repository + '/src/main/services/workspace-results.ts');
    const taskId = process.getBuiltinModule('node:crypto').randomUUID(), operationId = process.getBuiltinModule('node:crypto').randomUUID();
    const now = new Date().toISOString(), threadId = 'results-thread', turnId = 'results-turn';
    await req(repository + '/src/main/storage/results.ts').saveWorkspaceBaseline(root, { taskId, operationId }, await scan.captureWorkspace(directory), await scan.captureGitState(directory));
    tasks.beginTaskSubmission(root, { taskId, projectId: project.projectId, directory, title: '检查文件结果', executionState: 'submitting',
      threadId: null, turnId: null, lastActivityAt: now, observedAt: now }, { operationId, modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: process.getBuiltinModule('node:crypto').randomUUID(), text: '合成结果要求' });
    tasks.markSubmissionDispatched(root, taskId, operationId); tasks.bindSubmissionThread(root, taskId, operationId, threadId);
    tasks.acknowledgeSubmission(root, taskId, operationId, threadId, turnId); tasks.settleTaskTurn(root, taskId, operationId, threadId, turnId, state);
    ipcMain.removeHandler('agentx:task-history-read');
    ipcMain.handle('agentx:task-history-read', () => ({ taskId, threadId, turns: [{ turnId, status: state, items: [], unrepresentedItemTypes: [] }] }));
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed');
    return { taskId, turnId, directory, operationId };
  }, { repository: path.resolve('.'), state });
}

test('noChanges：用户打开改动后，经真实 Main 检查基线；关闭面板不丢草稿', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const binding = await seed(app);
  await page.getByRole('button', { name: '检查文件结果', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '查看文件改动', exact: true }).count(), 1);
  await page.getByRole('textbox', { name: '任务要求' }).fill('检查期间保留草稿');
  await page.getByRole('button', { name: '查看文件改动', exact: true }).click();
  await page.getByText('检查范围内没有文件变化', { exact: true }).waitFor();
  assert.match(await page.getByRole('region', { name: '文件改动' }).innerText(), /本轮开始.*当前检查/s);
  assert.match(await page.getByRole('region', { name: '文件改动' }).innerText(), /results-turn/);
  const result = await page.evaluate(binding => window.agentx.getTaskResults({ taskId: binding.taskId, turnId: binding.turnId }), binding);
  assert.deepEqual(result.changes, []);
  await page.getByRole('button', { name: '关闭改动面板' }).click();
  assert.equal(await page.getByRole('region', { name: '文件改动' }).count(), 0);
  assert.equal(await page.getByRole('textbox', { name: '任务要求' }).inputValue(), '检查期间保留草稿');
});

test('changes：实际 shell 改动与新增文件可见，未改动的人工文件不算本轮修改', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const binding = await seed(app);
  const fs = require('node:fs/promises');
  const { execFileSync } = require('node:child_process');
  execFileSync(process.execPath, ['-e', "const fs=require('node:fs');fs.writeFileSync('source.txt','第一行\\n修改后内容\\n');fs.writeFileSync('new.txt','新文件\\n');"], { cwd: binding.directory });
  await page.getByRole('button', { name: '检查文件结果', exact: true }).click();
  await page.getByRole('button', { name: '查看文件改动' }).click();
  await page.getByRole('status').filter({ hasText: '正在检查实际文件变化' }).waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: '修改 source.txt', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: '新增 new.txt', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: '修改 manual.txt', exact: true }).count(), 0);
  assert.equal(await fs.readFile(path.join(binding.directory, 'manual.txt'), 'utf8'), '本轮开始前人工留下的内容');
  assert.equal(await page.getByText('检查范围内没有文件变化', { exact: true }).count(), 0);
  assert.equal(await fs.readFile(path.join(binding.directory, 'source.txt'), 'utf8'), '第一行\n修改后内容\n');
});

test('textDiff：选中文件展示只读逐行增删和轮次，原文可展开核对', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const binding = await seed(app);
  await require('node:fs/promises').writeFile(path.join(binding.directory, 'source.txt'), '第一行\n修改后内容\n新增一行\n');
  await page.getByRole('button', { name: '检查文件结果', exact: true }).click();
  await page.getByRole('button', { name: '查看文件改动' }).click();
  await page.getByRole('button', { name: '修改 source.txt', exact: true }).click();
  assert.equal(await page.getByRole('region', { name: '只读文本差异' }).count(), 1);
  assert.match(await page.getByRole('region', { name: '只读文本差异' }).innerText(), /\+2.*-1/s);
  assert.match(await page.locator('.diff-removed').innerText(), /原始内容/);
  assert.match(await page.locator('.diff-added').allTextContents().then(values => values.join('\n')), /修改后内容.*新增一行/s);
  await page.getByText('本轮开始时的原文', { exact: true }).click();
  assert.match(await page.getByRole('region', { name: '文件原文' }).innerText(), /原始内容/);
  assert.equal(await page.locator('[contenteditable=true]').count(), 0);
});

test('unreadableResult：刷新时基线缺失，不能继续展示当前无变化，保留草稿并可重试', { timeout: 45000 }, async t => {
  const { app, page, data } = await launch(); t.after(() => app.close());
  const binding = await seed(app);
  await page.getByRole('button', { name: '检查文件结果', exact: true }).click();
  await page.getByRole('textbox', { name: '任务要求' }).fill('不要丢失输入');
  await page.getByRole('button', { name: '查看文件改动' }).click();
  await page.getByText('检查范围内没有文件变化', { exact: true }).waitFor();
  const fs = require('node:fs/promises'), filename = path.join(data, 'results', binding.operationId + '.baseline.json');
  const original = await fs.readFile(filename); await fs.unlink(filename);
  await page.getByRole('button', { name: '重新检查文件改动' }).click();
  await page.getByRole('alert').filter({ hasText: '本轮基线缺失' }).waitFor();
  assert.equal(await page.getByText('检查范围内没有文件变化', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('textbox', { name: '任务要求' }).inputValue(), '不要丢失输入');
  await fs.writeFile(filename, original);
  await page.getByRole('button', { name: '重新检查文件改动' }).click();
  await page.getByText('检查范围内没有文件变化', { exact: true }).waitFor();
});

test('结果面板键盘和设计 QA：打开后可立即操作，深浅色与紧凑窗口保持可读', { timeout: 90000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const binding = await seed(app), fs = require('node:fs/promises');
  await fs.writeFile(path.join(binding.directory, 'source.txt'), '第一行\n修改后内容\n新增一行\n');
  await page.getByRole('button', { name: '检查文件结果', exact: true }).click();
  await page.getByRole('button', { name: '查看文件改动' }).click();
  await page.getByRole('button', { name: '修改 source.txt', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '关闭改动面板');
  await page.getByRole('button', { name: '修改 source.txt', exact: true }).click();
  const geometry = await page.locator('.workspace').evaluate(element => ({ scroll: element.scrollHeight, client: element.clientHeight }));
  assert.ok(geometry.scroll <= geometry.client + 1, JSON.stringify(geometry));
  const output = path.resolve('.local-validation/m1-05');
  for (const [theme, label] of [['light', '浅色'], ['dark', '深色']]) {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await page.getByRole('button', { name: '返回工作台' }).click();
    await page.screenshot({ path: path.join(output, `results-${theme}.png`) });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
  await page.waitForFunction(() => innerWidth === 960);
  const bounds = await page.getByRole('region', { name: '文件改动' }).boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 960 && bounds.y + bounds.height <= 640);
  await page.screenshot({ path: path.join(output, 'results-compact.png') });
  await page.getByRole('button', { name: '放大改动面板' }).click();
  await page.getByRole('button', { name: '还原改动面板' }).click();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('region', { name: '文件改动' }).count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '查看文件改动');
});

test('结果 IPC 与二进制：拒绝任意路径/RPC；二进制不伪造文本，删除仍可核对原文', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const binding = await seed(app), fs = require('node:fs/promises');
  for (const input of [null, [], { taskId: binding.taskId, turnId: binding.turnId, path: 'C:\\Windows' }, { taskId: binding.taskId, method: 'turn/start' }]) {
    await assert.rejects(page.evaluate(input => window.agentx.getTaskResults(input), input), /结果读取请求无效/);
  }
  await fs.writeFile(path.join(binding.directory, 'binary.bin'), Buffer.from([0, 2, 3]));
  await fs.unlink(path.join(binding.directory, 'source.txt'));
  await page.getByRole('button', { name: '检查文件结果', exact: true }).click();
  await page.getByRole('button', { name: '查看文件改动' }).click();
  await page.getByRole('button', { name: '新增 binary.bin', exact: true }).click();
  await page.getByRole('note').filter({ hasText: '二进制或非 UTF-8 文件，不提供文本差异' }).waitFor();
  assert.equal(await page.getByRole('region', { name: '只读文本差异' }).count(), 0);
  await page.getByRole('button', { name: '删除 source.txt', exact: true }).click();
  assert.match(await page.getByRole('region', { name: '只读文本差异' }).innerText(), /-2/);
  assert.equal((await page.evaluate(() => window.agentx.getWorkspace())).tasks[0].executionState, 'completed');
});

for (const state of ['failed', 'interrupted']) test('partialResult：' + state + ' 仍能检查已知变化，不改变终态或人工文件', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const binding = await seed(app, state), fs = require('node:fs/promises');
  await fs.writeFile(path.join(binding.directory, 'source.txt'), '本轮只完成这部分修改\n');
  await page.getByRole('button', { name: '检查文件结果', exact: true }).click();
  await page.getByRole('button', { name: '查看文件改动', exact: true }).click();
  const panel = page.getByRole('region', { name: '文件改动' });
  await panel.getByRole('button', { name: '修改 source.txt', exact: true }).click();
  assert.match(await panel.innerText(), /仅显示已知变化，不代表目标完成或已撤销修改/);
  assert.match(await panel.getByRole('region', { name: '只读文本差异' }).innerText(), /本轮只完成这部分修改/);
  await page.getByRole('button', { name: '关闭改动面板' }).click();
  assert.equal((await page.evaluate(() => window.agentx.getWorkspace())).tasks[0].executionState, state);
  assert.equal(await fs.readFile(path.join(binding.directory, 'manual.txt'), 'utf8'), '本轮开始前人工留下的内容');
});
