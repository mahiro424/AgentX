const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { launch: launchDesktop } = require('./helpers.cjs');
const { crashTestApp } = require('./helpers.cjs');
// 材料与 Chromium 用户数据放在独立临时目录，不参与源仓库文件观察。
const launch = async () => launchDesktop(await fs.mkdtemp(path.join(os.tmpdir(), 'agentx-file-preview-')));

async function addFiles(app, page, files) {
  await app.evaluate(({ dialog }, files) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files }); }, files);
  await page.getByRole('button', { name: '添加材料', exact: true }).click();
  await page.getByRole('menuitem', { name: '添加文件', exact: true }).click();
  await page.getByRole('list', { name: '本轮材料' }).waitFor();
  await page.getByRole('status').filter({ hasText: '草稿已保存' }).waitFor();
}

test('材料预览标签：真实读取、只读文字、缩放和切换；关闭回到材料且不删原件', { timeout: 45000 }, async t => {
  const { app, page, data } = await launch(); t.after(() => app.close());
  const files = [path.join(data, '说明.md'), path.join(data, '事实.txt')];
  await fs.writeFile(files[0], '# 说明\n<script>globalThis.BAD_PREVIEW=true</script>\n');
  await fs.writeFile(files[1], '项目事实：周五交付\n');
  await addFiles(app, page, files);
  await page.getByRole('textbox', { name: '任务要求' }).fill('保留输入');
  await page.getByRole('button', { name: '预览材料：说明.md' }).click();
  const preview = page.getByRole('region', { name: '只读文件预览' });
  await preview.getByText('# 说明', { exact: false }).waitFor();
  assert.match(await preview.locator('pre').innerText(), /<script>/);
  assert.equal(await page.evaluate(() => globalThis.BAD_PREVIEW), undefined);
  assert.equal(await preview.locator('[contenteditable=true],iframe,webview').count(), 0);
  await preview.getByRole('button', { name: '放大文字' }).click();
  assert.equal(await preview.getByRole('button', { name: '还原文字缩放' }).textContent(), '110%');
  await page.getByRole('button', { name: '预览材料：事实.txt' }).click();
  await preview.getByText('项目事实：周五交付', { exact: false }).waitFor();
  assert.equal(await preview.getByRole('tab').count(), 2);
  await preview.getByRole('tab', { name: '说明.md', exact: true }).click();
  assert.equal(await preview.getByRole('button', { name: '还原文字缩放' }).textContent(), '110%');
  await preview.getByRole('button', { name: '关闭标签：事实.txt' }).click();
  assert.equal(await preview.getByRole('tab', { name: '说明.md', exact: true }).evaluate(element => document.activeElement === element), true);
  await page.getByRole('button', { name: '预览材料：事实.txt' }).click();
  await preview.getByRole('tab', { name: '说明.md', exact: true }).click();
  await preview.getByRole('button', { name: '关闭标签：说明.md' }).click();
  await preview.getByText('项目事实：周五交付', { exact: false }).waitFor();
  await preview.getByRole('button', { name: '关闭文件预览' }).press('Escape');
  assert.equal(await page.getByRole('region', { name: '只读文件预览' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '预览材料：事实.txt' }).evaluate(element => document.activeElement === element), true);
  assert.equal(await page.getByRole('textbox', { name: '任务要求' }).inputValue(), '保留输入');
  assert.equal(await fs.readFile(files[1], 'utf8'), '项目事实：周五交付\n');
});

test('预览晚回：切换文件后旧请求不覆盖新文件；系统打开失败明确保留原件', { timeout: 45000 }, async t => {
  const { app, page, data } = await launch(); t.after(() => app.close());
  const files = [path.join(data, '慢文件.txt'), path.join(data, '当前文件.md')];
  await fs.writeFile(files[0], '旧请求文本'); await fs.writeFile(files[1], '# 当前文件内容');
  await addFiles(app, page, files);
  await app.evaluate(({ app, ipcMain, shell }, repository) => {
    const req = process.getBuiltinModule('node:module').createRequire(repository + '/package.json');
    req('ts-node').register({ transpileOnly: true, project: repository + '/tsconfig.json' });
    const read = req(repository + '/src/main/services/file-preview.ts').readFilePreview;
    let delayed = false;
    ipcMain.removeHandler('agentx:file-preview-read');
    ipcMain.handle('agentx:file-preview-read', async (_event, source) => {
      const result = await read(app.getPath('userData'), source);
      if (result.name === '慢文件.txt' && !delayed) { delayed = true; return new Promise(resolve => { globalThis.finishPreview = () => resolve(result); }); }
      return result;
    });
    shell.openPath = async filename => { globalThis.openedPreviewPath = filename; return '合成系统打开失败：没有默认应用'; };
  }, path.resolve('.'));
  await page.getByRole('button', { name: '预览材料：慢文件.txt' }).click();
  const preview = page.getByRole('region', { name: '只读文件预览' });
  await preview.getByRole('status').filter({ hasText: '正在核验' }).waitFor();
  await page.getByRole('button', { name: '预览材料：当前文件.md' }).click();
  await preview.locator('pre').filter({ hasText: '# 当前文件内容' }).waitFor();
  await app.evaluate(() => globalThis.finishPreview());
  await page.evaluate(() => window.agentx.getAppInfo());
  assert.equal(await preview.locator('pre').innerText(), '# 当前文件内容');
  assert.equal(await preview.getByRole('tab', { name: '当前文件.md' }).getAttribute('aria-selected'), 'true');
  await preview.getByRole('button', { name: '本机打开', exact: true }).click();
  await preview.getByRole('status').filter({ hasText: '没有默认应用' }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.openedPreviewPath), await fs.realpath(files[1]));
  assert.equal(await fs.readFile(files[1], 'utf8'), '# 当前文件内容');
});

test('首发预览：材料随草稿进入任务，再次点击同一材料不重建标签或丢失缩放', { timeout: 45000 }, async t => {
  const { app, page, data } = await launch(); t.after(() => crashTestApp(app));
  const projectId = await app.evaluate(async ({ app, ipcMain, BrowserWindow }, repository) => {
    const req = process.getBuiltinModule('node:module').createRequire(repository + '/package.json');
    req('ts-node').register({ transpileOnly: true, project: repository + '/tsconfig.json' });
    const root = await req('node:fs/promises').realpath(app.getPath('userData')), project = req(repository + '/src/main/storage/projects.ts').associateProject(root, root).project;
    const model = 'deepseek-v4-flash';
    ipcMain.removeHandler('agentx:model-settings-read');
    ipcMain.handle('agentx:model-settings-read', () => ({ hasCredential: true, enabled: true, configRevision: 3, activeModelId: model,
      selectedModelIds: [model], catalog: { modelIds: [model], fetchedAt: null, configRevision: 3 }, fetching: false, saving: false,
      fetchError: null, keySaveError: null, testing: null, tests: [] }));
    ipcMain.removeHandler('agentx:execution-start');
    ipcMain.handle('agentx:execution-start', (_event, request) => {
      const now = new Date().toISOString();
      const task = { taskId: request.taskId, projectId: project.projectId, directory: root, title: request.text,
        lastActivityAt: now, observedAt: now, executionState: 'running', threadId: 'preview-thread', turnId: 'preview-turn' };
      req(repository + '/src/main/storage/tasks.ts').createTaskRecord(root, task);
      ipcMain.removeHandler('agentx:execution-read');
      ipcMain.handle('agentx:execution-read', () => ({ preparing: false, task, operationId: request.operationId, inputText: request.text, items: [], approvals: [], error: null }));
      BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed');
      BrowserWindow.getAllWindows()[0].webContents.send('agentx:execution-changed');
      return task;
    });
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed');
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:model-settings-changed');
    return project.projectId;
  }, path.resolve('.'));
  await page.getByRole('combobox', { name: '工作目录' }).selectOption(projectId);
  const filename = path.join(data, '材料.txt'); await fs.writeFile(filename, '任务材料'); await addFiles(app, page, [filename]);
  await page.getByRole('button', { name: '预览材料：材料.txt' }).click();
  const preview = page.getByRole('region', { name: '只读文件预览' });
  await preview.locator('pre').waitFor(); await preview.getByRole('button', { name: '放大文字' }).click();
  await page.getByRole('textbox', { name: '任务要求' }).fill('阅读后生成新文件');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('button', { name: '停止', exact: true }).waitFor();
  await page.getByRole('button', { name: '预览材料：材料.txt' }).click();
  assert.equal(await preview.getByRole('tab').count(), 1);
  assert.equal(await preview.getByRole('button', { name: '还原文字缩放' }).textContent(), '110%');
  assert.equal(await preview.locator('pre').innerText(), '任务材料');
});

test('预览核对：外部变化和缺失保留旧文本且标陈旧，设置往返保留缩放和阅读位置', { timeout: 45000 }, async t => {
  const { app, page, data } = await launch(); t.after(() => app.close());
  const filename = path.join(data, '长材料.txt'), original = Array.from({ length: 160 }, (_, i) => `原内容第 ${i + 1} 行`).join('\n');
  await fs.writeFile(filename, original); await addFiles(app, page, [filename]);
  await page.getByRole('button', { name: '预览材料：长材料.txt' }).click();
  const preview = page.getByRole('region', { name: '只读文件预览' });
  await preview.locator('pre').waitFor();
  await preview.getByRole('button', { name: '放大文字' }).click();
  await preview.getByRole('tabpanel').evaluate(element => { element.scrollTop = 300; element.dispatchEvent(new Event('scroll', { bubbles: true })); });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  assert.equal(await preview.getByRole('button', { name: '还原文字缩放' }).textContent(), '110%');
  assert.equal(await preview.getByRole('tabpanel').evaluate(element => element.scrollTop), 300);
  await fs.writeFile(filename, '外部新版本，不应冒充原版本');
  await preview.getByRole('button', { name: '重新核验预览' }).click();
  await preview.getByRole('alert').filter({ hasText: '变化' }).waitFor();
  assert.equal(await preview.locator('pre').innerText(), original);
  await preview.getByRole('note').filter({ hasText: '保留上次成功读取' }).waitFor();
  assert.equal(await preview.getByRole('button', { name: '本机打开', exact: true }).isDisabled(), true);
  await fs.unlink(filename);
  await preview.getByRole('button', { name: '重新核验预览' }).click();
  await preview.getByRole('alert').filter({ hasText: '删除' }).waitFor();
  assert.equal(await preview.locator('pre').innerText(), original);
  assert.equal(await preview.getByRole('button', { name: '定位', exact: true }).isDisabled(), true);
});
