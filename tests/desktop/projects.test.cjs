const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launch, crashTestApp } = require('./helpers.cjs');

async function chooseDirectory(app, page, directory) {
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, directory);
  await page.getByRole('button', { name: '关联项目', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /已关联项目|已定位到关联过的项目/ }).waitFor();
}

test('M1-03 empty：从公开接口读取空项目和会话，不创建假记录', { timeout: 30000 }, async t => {
  const { app, page } = await launch();
  t.after(() => app.close());
  assert.deepEqual(await page.evaluate(() => window.agentx.getWorkspace()), { projects: [], tasks: [] });
  await page.getByText('尚无项目或会话', { exact: true }).waitFor();
  await page.getByText('在工作台写下目标，也可以先选择本地项目。', { exact: true }).waitFor();
  assert.equal(await page.getByText('最近', { exact: true }).count(), 0);
});

test('M1-03 selecting：原生单目录选择可取消，不写入记录或清空草稿', { timeout: 30000 }, async t => {
  const { app, page, data } = await launch();
  t.after(() => app.close());
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async (_window, options) => {
      globalThis.directoryOptions = options;
      return { canceled: true, filePaths: [] };
    };
  });
  await page.getByRole('textbox', { name: '任务要求' }).fill('取消选目录也保留');
  await page.getByRole('button', { name: '关联项目', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已取消选择' }).waitFor();
  assert.deepEqual((await app.evaluate(() => globalThis.directoryOptions)).properties, ['openDirectory']);
  assert.deepEqual(await page.evaluate(() => window.agentx.getWorkspace()), { projects: [], tasks: [] });
  assert.equal(await page.getByRole('textbox', { name: '任务要求' }).inputValue(), '取消选目录也保留');
  await page.getByRole('status').filter({ hasText: '草稿已保存' }).waitFor();
  assert.equal((await page.evaluate(() => window.agentx.getDraft({ projectId: null, taskId: null }))).text, '取消选目录也保留');
});

test('M1-03 associated：中文空格目录真实关联并重开，不复制或改动原件', { timeout: 90000 }, async t => {
  let current = await launch();
  t.after(() => current.app.close());
  const directory = path.join(current.data, '合成 项目');
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, '原件.txt'), '人工原件保持不变', 'utf8');
  await chooseDirectory(current.app, current.page, directory);
  const snapshot = await current.page.evaluate(() => window.agentx.getWorkspace());
  assert.equal(snapshot.projects.length, 1);
  assert.equal(snapshot.tasks.length, 0);
  assert.equal(snapshot.projects[0].directory, await fs.realpath(directory));
  await current.page.getByRole('combobox', { name: '工作目录' }).waitFor();
  assert.equal(await current.page.getByRole('combobox', { name: '工作目录' }).inputValue(), snapshot.projects[0].projectId);
  assert.equal(await current.page.getByRole('button', { name: '合成 项目', exact: true }).getAttribute('title'), await fs.realpath(directory));
  const data = current.data;
  await current.app.close();
  current = await launch(data);
  await current.page.getByRole('button', { name: '合成 项目', exact: true }).waitFor();
  assert.deepEqual(await current.page.evaluate(() => window.agentx.getWorkspace()), snapshot);
  assert.deepEqual(await fs.readdir(directory), ['原件.txt']);
  assert.equal(await fs.readFile(path.join(directory, '原件.txt'), 'utf8'), '人工原件保持不变');
  await current.page.getByRole('button', { name: '合成 项目', exact: true }).click();
  const before = await current.page.getByRole('combobox', { name: '工作目录' }).inputValue();
  await current.app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
  await current.page.getByRole('button', { name: '关联项目', exact: true }).click();
  await current.page.getByRole('status').filter({ hasText: '已取消选择' }).waitFor();
  assert.equal(await current.page.getByRole('combobox', { name: '工作目录' }).inputValue(), before);
});

test('M1-03 duplicate：同目录、大小写别名和 junction 定位已有项目，不合并其他目标', { timeout: 40000 }, async t => {
  const { app, page, data } = await launch();
  t.after(() => app.close());
  const directory = path.join(data, 'OriginalFolder');
  const other = path.join(data, 'OtherFolder');
  const alias = path.join(data, '目录别名');
  await fs.mkdir(directory); await fs.mkdir(other);
  await fs.symlink(directory, alias, 'junction');
  await chooseDirectory(app, page, directory);
  const first = (await page.evaluate(() => window.agentx.getWorkspace())).projects[0];
  await chooseDirectory(app, page, other);
  for (const selected of [directory, directory.toUpperCase(), path.join(directory, '.'), alias]) {
    await chooseDirectory(app, page, selected);
    await page.getByRole('status').filter({ hasText: '已定位到关联过的项目' }).waitFor();
    assert.equal(await page.getByRole('combobox', { name: '工作目录' }).inputValue(), first.projectId);
  }
  const result = await page.evaluate(() => window.agentx.getWorkspace());
  assert.equal(result.projects.length, 2);
  assert.deepEqual(result.projects.find(project => project.projectId === first.projectId), first);
  assert.equal(await fs.realpath(alias), await fs.realpath(directory));
});

test('M1-03 editing：铅笔和菜单打开同一编辑浮层，Enter 保存、Escape 取消且不改磁盘名称', { timeout: 30000 }, async t => {
  const { app, page, data } = await launch();
  t.after(() => app.close());
  const directory = path.join(data, '编辑项目'); await fs.mkdir(directory);
  await chooseDirectory(app, page, directory);
  const initial = (await page.evaluate(() => window.agentx.getWorkspace())).projects[0];
  const pencil = page.getByRole('button', { name: '编辑项目名称：编辑项目', exact: true });
  await pencil.focus(); await page.keyboard.press('Enter');
  const editor = page.getByRole('dialog', { name: '编辑项目' });
  await editor.waitFor();
  const name = editor.getByRole('textbox', { name: '项目名称', exact: true });
  await page.waitForFunction(() => document.activeElement?.getAttribute('id') === 'project-name');
  assert.equal(await editor.getByRole('textbox', { name: '工作目录', exact: true }).inputValue(), await fs.realpath(directory));
  await name.fill('不应保存'); await name.press('Escape');
  await editor.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '编辑项目名称：编辑项目');
  assert.equal(await pencil.evaluate(element => document.activeElement === element), true);
  assert.deepEqual((await page.evaluate(() => window.agentx.getWorkspace())).projects[0], initial);
  await page.getByRole('button', { name: '项目操作：编辑项目', exact: true }).click();
  await page.getByRole('menuitem', { name: '编辑名称' }).press('Enter');
  await name.fill('产品显示名称');
  await name.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  assert.equal(await editor.isVisible(), true);
  await name.press('Enter'); await editor.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '产品显示名称', exact: true }).waitFor();
  const saved = (await page.evaluate(() => window.agentx.getWorkspace())).projects[0];
  assert.deepEqual(saved, { ...initial, displayName: '产品显示名称', revision: initial.revision + 1 });
  assert.equal((await fs.stat(directory)).isDirectory(), true);
  assert.equal((await fs.readdir(data)).includes('产品显示名称'), false);
});

test('M1-03 saveFailed：真实数据库写锁失败保留输入和原记录，解除后手动保存', { timeout: 30000 }, async t => {
  const { app, page, data } = await launch();
  t.after(() => app.close());
  const directory = path.join(data, '写锁项目'); await fs.mkdir(directory);
  await chooseDirectory(app, page, directory);
  const initial = (await page.evaluate(() => window.agentx.getWorkspace())).projects[0];
  await page.getByRole('button', { name: '编辑项目名称：写锁项目' }).focus(); await page.keyboard.press('Enter');
  const editor = page.getByRole('dialog', { name: '编辑项目' });
  await editor.getByRole('textbox', { name: '项目名称', exact: true }).fill('失败时要保留的名称');
  await app.evaluate(({ app }) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const path = process.getBuiltinModule('node:path');
    globalThis.projectLock = new DatabaseSync(path.join(app.getPath('userData'), 'agentx.db'));
    globalThis.projectLock.exec('BEGIN IMMEDIATE');
  });
  try {
    await editor.getByRole('button', { name: '保存名称' }).click();
    await editor.getByRole('alert').filter({ hasText: '元数据读取或写入失败' }).waitFor();
    assert.equal(await editor.getByRole('textbox', { name: '项目名称', exact: true }).inputValue(), '失败时要保留的名称');
    assert.deepEqual((await page.evaluate(() => window.agentx.getWorkspace())).projects[0], initial);
  } finally { await app.evaluate(() => { globalThis.projectLock.exec('ROLLBACK'); globalThis.projectLock.close(); delete globalThis.projectLock; }); }
  await editor.getByRole('button', { name: '保存名称' }).click(); await editor.waitFor({ state: 'hidden' });
  assert.equal((await page.evaluate(() => window.agentx.getWorkspace())).projects[0].displayName, '失败时要保留的名称');
  assert.equal((await fs.stat(directory)).isDirectory(), true);
});

test('M1-03 missingDirectory：目录移走后显示不可用，保留关联与草稿并阻断新执行', { timeout: 30000 }, async t => {
  const { app, page, data } = await launch();
  t.after(() => app.close());
  const directory = path.join(data, '会失效的目录'); await fs.mkdir(directory);
  await chooseDirectory(app, page, directory);
  const initial = (await page.evaluate(() => window.agentx.getWorkspace())).projects[0];
  await page.getByRole('textbox', { name: '任务要求' }).fill('先保留目标');
  const moved = path.join(data, '由测试移动后的目录');
  assert.equal(path.dirname(directory), data); assert.equal(path.dirname(moved), data);
  await fs.rename(directory, moved);
  await page.getByRole('button', { name: '会失效的目录', exact: true }).click();
  await page.getByRole('note').filter({ hasText: '工作目录不可用' }).waitFor();
  const value = (await page.evaluate(() => window.agentx.getWorkspace())).projects[0];
  assert.equal(value.projectId, initial.projectId);
  assert.equal(value.directory, initial.directory);
  assert.equal(value.directoryState, 'unavailable');
  assert.match(value.directoryError, /不存在/);
  assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('textbox', { name: '任务要求' }).inputValue(), '先保留目标');
  await page.getByRole('button', { name: '编辑项目名称：会失效的目录' }).focus(); await page.keyboard.press('Enter');
  await page.getByRole('dialog').getByRole('alert').filter({ hasText: '不存在' }).waitFor();
});

test('M1-03 loading：列表读取中保留已显示内容，晚到旧快照不覆盖新读取', { timeout: 30000 }, async t => {
  const { app, page, data } = await launch();
  t.after(() => app.close());
  const directory = path.join(data, '加载中的项目'); await fs.mkdir(directory);
  await chooseDirectory(app, page, directory);
  const snapshot = await page.evaluate(() => window.agentx.getWorkspace());
  await app.evaluate(({ ipcMain, BrowserWindow }, snapshot) => {
    ipcMain.removeHandler('agentx:workspace-read');
    let count = 0;
    ipcMain.handle('agentx:workspace-read', () => {
      if (++count === 1) return new Promise(resolve => { globalThis.finishWorkspaceRead = () => resolve({ projects: [], tasks: [] }); });
      return snapshot;
    });
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed');
  }, snapshot);
  await page.getByRole('status').filter({ hasText: '正在读取项目和会话' }).waitFor();
  await page.getByRole('button', { name: '加载中的项目', exact: true }).waitFor();
  assert.equal(await page.getByText('尚无项目或会话', { exact: true }).count(), 0);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed'));
  await page.getByRole('status').filter({ hasText: '正在读取项目和会话' }).waitFor({ state: 'hidden' });
  await app.evaluate(() => { globalThis.finishWorkspaceRead(); delete globalThis.finishWorkspaceRead; });
  await page.getByRole('button', { name: '加载中的项目', exact: true }).waitFor();
  assert.equal(await page.getByText('尚无项目或会话', { exact: true }).count(), 0);
});

test('M1-03 error：数据库文件权限检查失败不能变成空历史，可重试且保留内容', { timeout: 30000 }, async t => {
  const { app, page, data } = await launch();
  t.after(() => app.close());
  const directory = path.join(data, '故障时保留'); await fs.mkdir(directory);
  await chooseDirectory(app, page, directory);
  await page.getByRole('textbox', { name: '任务要求' }).fill('读失败不能丢');
  await app.evaluate(({ app, BrowserWindow }) => {
    const fs = process.getBuiltinModule('node:fs'), path = process.getBuiltinModule('node:path');
    const target = path.join(app.getPath('userData'), 'agentx.db');
    const exists = fs.existsSync, lstat = fs.lstatSync;
    fs.existsSync = (file, ...args) => file === target ? false : exists(file, ...args);
    fs.lstatSync = (file, ...args) => { if (file === target) throw Object.assign(new Error('合成 EACCES'), { code: 'EACCES' }); return lstat(file, ...args); };
    globalThis.restoreDatabaseAccess = () => { fs.existsSync = exists; fs.lstatSync = lstat; };
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed');
  });
  try {
    await page.getByRole('alert').filter({ hasText: '数据库' }).waitFor();
    await page.getByRole('button', { name: '故障时保留', exact: true }).waitFor();
    assert.equal(await page.getByText('尚无项目或会话', { exact: true }).count(), 0);
    await assert.rejects(page.evaluate(() => window.agentx.getWorkspace()), /数据库/);
  } finally { await app.evaluate(() => { globalThis.restoreDatabaseAccess(); delete globalThis.restoreDatabaseAccess; }); }
  await page.getByRole('button', { name: '重读项目和会话' }).click();
  await page.getByRole('alert').waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('textbox', { name: '任务要求' }).inputValue(), '读失败不能丢');
});

test('M1-03 active：公开快照的运行与等待标记不同，更新观测不重排；非真实引擎验收', { timeout: 30000 }, async t => {
  const { app, page, data } = await launch();
  t.after(() => app.close());
  const directory = path.join(data, '会话状态项目'); await fs.mkdir(directory);
  await chooseDirectory(app, page, directory);
  const snapshot = await page.evaluate(() => window.agentx.getWorkspace());
  const project = snapshot.projects[0];
  const now = new Date().toISOString();
  const tasks = ['运行中的合成记录', '等待批准的合成记录'].map((title, i) => ({ taskId: `task-fixture-${i}`, projectId: project.projectId,
    title, directory: project.directory, organizationRevision: 0, pinnedAt: null, archivedAt: null, lastActivityAt: now, observedAt: now, executionState: i === 0 ? 'running' : 'waitingApproval', threadId: `thread-fixture-${i}`, turnId: `turn-fixture-${i}` }));
  await app.evaluate(({ ipcMain, BrowserWindow }, snapshot) => {
    globalThis.workspaceFixture = snapshot;
    ipcMain.removeHandler('agentx:workspace-read'); ipcMain.handle('agentx:workspace-read', () => globalThis.workspaceFixture);
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed');
  }, { ...snapshot, tasks });
  await page.getByRole('img', { name: '正在运行' }).waitFor();
  await page.getByRole('img', { name: '等待批准' }).waitFor();
  await page.getByRole('button', { name: '运行中的合成记录', exact: true }).hover();
  assert.equal(await page.getByRole('img', { name: '正在运行' }).isVisible(), true, '悬停操作不能隐藏运行状态');
  await page.getByRole('button', { name: '等待批准的合成记录', exact: true }).focus();
  assert.equal(await page.getByRole('img', { name: '等待批准' }).isVisible(), true, '键盘聚焦不能隐藏等待状态');
  const rows = page.getByRole('list', { name: '会话状态项目的会话' }).getByRole('button');
  const before = await rows.allTextContents();
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.workspaceFixture.tasks[0].observedAt = new Date().toISOString();
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed');
  });
  assert.deepEqual(await rows.allTextContents(), before);
  await page.getByRole('button', { name: '收起项目：会话状态项目' }).click();
  await rows.first().waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('combobox', { name: '工作目录' }).inputValue(), project.projectId);
  await page.getByRole('button', { name: '展开项目：会话状态项目' }).click();
  await page.getByRole('img', { name: '正在运行' }).waitFor();
});

test('M1-03 inactive：持久化会话读取真实活动时间，打开不刷新；重开不伪称旧任务还在运行', { timeout: 90000 }, async t => {
  let current = await launch();
  t.after(() => crashTestApp(current.app));
  const directory = path.join(current.data, '历史项目'); await fs.mkdir(directory);
  await chooseDirectory(current.app, current.page, directory);
  const project = (await current.page.evaluate(() => window.agentx.getWorkspace())).projects[0];
  // 通过产品存储公开接缝生成合成记录，绝不在生产页面播种会话或直接改私有表造状态。
  require('ts-node').register({ transpileOnly: true });
  const { createTaskRecord } = require('../../src/main/storage/tasks.ts');
  const time = new Date(Date.now() - 12 * 60 * 1000).toISOString();
  const task = { taskId: require('node:crypto').randomUUID(), projectId: project.projectId, title: '合成失败记录', directory: project.directory,
    executionState: 'failed', lastActivityAt: time, observedAt: time, threadId: 'synthetic-thread-1', turnId: 'synthetic-turn-1' };
  createTaskRecord(current.data, task);
  createTaskRecord(current.data, { ...task, taskId: require('node:crypto').randomUUID(), title: '旧活动记录', executionState: 'running', threadId: 'synthetic-thread-2' });
  await current.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed'));
  const row = current.page.getByRole('button', { name: '合成失败记录', exact: true });
  await row.waitFor();
  assert.match(await row.textContent(), /12分/);
  assert.match(await row.getAttribute('title'), /本轮失败/);
  const before = await current.page.evaluate(() => window.agentx.getWorkspace());
  await row.click();
  await current.page.getByRole('heading', { name: '合成失败记录' }).waitFor();
  assert.deepEqual(await current.page.evaluate(() => window.agentx.getWorkspace()), before);
  const data = current.data; await crashTestApp(current.app); current = await launch(data);
  const reopened = await current.page.evaluate(() => window.agentx.getWorkspace());
  assert.equal(reopened.tasks.find(value => value.title === '旧活动记录').executionState, 'reconciling');
  assert.equal(reopened.tasks.find(value => value.title === '合成失败记录').lastActivityAt, time);
  await current.page.getByRole('img', { name: '状态待核对' }).waitFor();
  assert.equal(await current.page.getByRole('img', { name: '正在运行' }).count(), 0);
});

test('迁移失败：旧版模型数据先留一致性快照，失败整体回滚、不留下半次项目迁移', { timeout: 30000 }, async t => {
  const { app, page, data } = await launch();
  t.after(() => crashTestApp(app));
  await app.evaluate(({ app }) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite'), path = process.getBuiltinModule('node:path');
    const db = new DatabaseSync(path.join(app.getPath('userData'), 'agentx.db'));
    db.exec(`CREATE TABLE model_catalog (id INTEGER PRIMARY KEY CHECK(id=1), model_ids TEXT NOT NULL, fetched_at TEXT NOT NULL, config_revision INTEGER NOT NULL);
      CREATE TABLE model_tests (operation_id TEXT PRIMARY KEY, model_id TEXT NOT NULL, config_revision INTEGER NOT NULL, credential_ref TEXT NOT NULL, tested_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('passed','failed')), error TEXT);
      CREATE TABLE model_key_save (id INTEGER PRIMARY KEY CHECK(id=1), previous_ref TEXT);
      INSERT INTO model_catalog VALUES (1, '["synthetic-model"]', '2026-09-01T00:00:00.000Z', 7);
      CREATE TABLE tasks (conflicting_column TEXT);
      PRAGMA user_version=3;`);
    db.close();
  });
  await assert.rejects(page.evaluate(() => window.agentx.getWorkspace()), /元数据/);
  const result = await app.evaluate(({ app }) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite'), path = process.getBuiltinModule('node:path');
    const db = new DatabaseSync(path.join(app.getPath('userData'), 'agentx.db'));
    try { return { version: db.prepare('PRAGMA user_version').get().user_version, hasProjects: !!db.prepare("SELECT 1 FROM sqlite_master WHERE name='projects'").get(), catalog: db.prepare('SELECT model_ids FROM model_catalog').get().model_ids }; }
    finally { db.close(); }
  });
  assert.deepEqual(result, { version: 3, hasProjects: false, catalog: '["synthetic-model"]' });
  assert.ok((await fs.readdir(data)).some(name => /^agentx\.before-v14\..+\.db$/.test(name)));
});

test('损坏记录：项目字段与会话目录关联损坏时报错，不隐藏或错误归组', { timeout: 30000 }, async t => {
  const { app, page, data } = await launch();
  t.after(() => crashTestApp(app));
  const directory = path.join(data, '损坏记录验证'); await fs.mkdir(directory);
  await chooseDirectory(app, page, directory);
  const project = (await page.evaluate(() => window.agentx.getWorkspace())).projects[0];
  require('ts-node').register({ transpileOnly: true });
  const { createTaskRecord } = require('../../src/main/storage/tasks.ts');
  const time = new Date().toISOString();
  createTaskRecord(data, { taskId: require('node:crypto').randomUUID(), projectId: project.projectId, directory: project.directory,
    title: '保留原记录', executionState: 'completed', threadId: 'synthetic-corruption', turnId: null, lastActivityAt: time, observedAt: time });
  await app.evaluate(({ app }) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite'), path = process.getBuiltinModule('node:path');
    const db = new DatabaseSync(path.join(app.getPath('userData'), 'agentx.db'));
    db.prepare('UPDATE tasks SET directory=?').run(path.join(app.getPath('userData'), '另一目录')); db.close();
  });
  await assert.rejects(page.evaluate(() => window.agentx.getWorkspace()), /记录格式或关联无效/);
  await app.evaluate(({ app }, original) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite'), path = process.getBuiltinModule('node:path');
    const db = new DatabaseSync(path.join(app.getPath('userData'), 'agentx.db'));
    db.prepare('UPDATE tasks SET directory=?').run(original); db.exec("UPDATE projects SET display_name='', revision='invalid'"); db.close();
  }, project.directory);
  await assert.rejects(page.evaluate(() => window.agentx.getWorkspace()), /记录格式或关联无效/);
});

test('compact / keyboard：紧凑新会话离开旧记录，菜单 resize 关闭后焦点仍可定位', { timeout: 30000 }, async t => {
  const { app, page, data } = await launch();
  t.after(() => app.close());
  const directory = path.join(data, '键盘项目'); await fs.mkdir(directory);
  await chooseDirectory(app, page, directory);
  const project = (await page.evaluate(() => window.agentx.getWorkspace())).projects[0];
  require('ts-node').register({ transpileOnly: true });
  const { createTaskRecord } = require('../../src/main/storage/tasks.ts'); const time = new Date().toISOString();
  createTaskRecord(data, { taskId: require('node:crypto').randomUUID(), projectId: project.projectId, directory: project.directory,
    title: '刚才查看的记录', executionState: 'completed', threadId: 'synthetic-keyboard', turnId: null, lastActivityAt: time, observedAt: time });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed'));
  await page.getByRole('button', { name: '刚才查看的记录', exact: true }).click();
  await page.getByRole('textbox', { name: '任务要求' }).fill('仍保留输入');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
  await page.getByRole('button', { name: '展开侧栏' }).waitFor();
  await page.getByRole('button', { name: '新会话', exact: true }).click();
  await page.getByRole('heading', { name: '今天想完成什么工作？' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '任务要求' }).inputValue(), '');
  await page.getByRole('button', { name: '展开侧栏' }).click();
  await page.getByRole('button', { name: '刚才查看的记录', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#task-draft').value === '仍保留输入');
  await page.getByRole('button', { name: '项目操作：键盘项目' }).focus(); await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: '编辑名称' }).waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 660));
  await page.getByRole('menu').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '项目操作：键盘项目');
});

test('侧栏焦点：展开后的延迟恢复不抢走用户已移到项目操作上的焦点', { timeout: 30000 }, async t => {
  const { app, page, data } = await launch();
  t.after(() => app.close());
  const directory = path.join(data, '焦点项目'); await fs.mkdir(directory);
  await chooseDirectory(app, page, directory);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
  await page.getByRole('button', { name: '展开侧栏' }).waitFor();
  await page.evaluate(() => {
    const original = window.requestAnimationFrame;
    const callbacks = [];
    window.requestAnimationFrame = callback => { callbacks.push(callback); return callbacks.length; };
    window.releaseSidebarFrames = () => {
      window.requestAnimationFrame = original;
      for (const callback of callbacks) callback(performance.now());
      delete window.releaseSidebarFrames;
    };
  });
  await page.getByRole('button', { name: '展开侧栏' }).click();
  const trigger = page.getByRole('button', { name: '项目操作：焦点项目' });
  await trigger.focus();
  await page.evaluate(() => window.releaseSidebarFrames());
  assert.equal(await trigger.evaluate(element => document.activeElement === element), true);
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: '编辑名称' }).waitFor();
});

test('关联失败反馈：目录读取失败不被晚到的正常列表读取抹掉', { timeout: 30000 }, async t => {
  const { app, page } = await launch();
  t.after(() => app.close());
  await page.getByText('尚无项目或会话', { exact: true }).waitFor();
  await app.evaluate(({ ipcMain, BrowserWindow, dialog }) => {
    ipcMain.removeHandler('agentx:workspace-read');
    ipcMain.handle('agentx:workspace-read', () => new Promise(resolve => { globalThis.finishNormalRead = () => resolve({ projects: [], tasks: [] }); }));
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed');
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['Z:\\synthetic-missing-project'] });
  });
  await page.getByRole('status').filter({ hasText: '正在读取项目和会话' }).waitFor();
  await page.getByRole('button', { name: '关联项目', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '所选目录不存在或无法读取' }).waitFor();
  await app.evaluate(() => { globalThis.finishNormalRead(); delete globalThis.finishNormalRead; });
  await page.getByRole('status').filter({ hasText: '正在读取项目和会话' }).waitFor({ state: 'hidden' });
  await page.getByRole('alert').filter({ hasText: '所选目录不存在或无法读取' }).waitFor();
});

test('编辑错误路径：损坏项目拒绝修改，报错后原名称和修订号保持不变', { timeout: 30000 }, async t => {
  const { app, page, data } = await launch();
  t.after(() => app.close());
  const directory = path.join(data, '编辑事务验证'); await fs.mkdir(directory);
  await chooseDirectory(app, page, directory);
  const project = (await page.evaluate(() => window.agentx.getWorkspace())).projects[0];
  await app.evaluate(({ app }) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite'), path = process.getBuiltinModule('node:path');
    const db = new DatabaseSync(path.join(app.getPath('userData'), 'agentx.db'));
    db.exec("UPDATE projects SET created_at='invalid'"); db.close();
  });
  await assert.rejects(page.evaluate(project => window.agentx.renameProject({ projectId: project.projectId,
    displayName: '不应保存的名称', expectedRevision: project.revision, operationId: crypto.randomUUID() }), project), /记录格式或关联无效/);
  // 恢复故障注入字段，再通过产品接口核对没有部分提交。
  await app.evaluate(({ app }, createdAt) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite'), path = process.getBuiltinModule('node:path');
    const db = new DatabaseSync(path.join(app.getPath('userData'), 'agentx.db'));
    db.prepare('UPDATE projects SET created_at=?').run(createdAt); db.close();
  }, project.createdAt);
  assert.deepEqual((await page.evaluate(() => window.agentx.getWorkspace())).projects[0], project);
});

test('项目 IPC 边界：拒绝任意目录参数、非法名称、过期编辑和同地址外来窗口', { timeout: 30000 }, async t => {
  const { app, page, data } = await launch();
  t.after(() => app.close());
  for (const request of [null, [], {}, { operationId: 'invalid' }, { operationId: require('node:crypto').randomUUID(), directory: data }]) {
    await assert.rejects(page.evaluate(value => window.agentx.chooseProject(value), request), /目录选择请求无效/);
  }
  const directory = path.join(data, '边界验证'); await fs.mkdir(directory);
  await chooseDirectory(app, page, directory);
  const project = (await page.evaluate(() => window.agentx.getWorkspace())).projects[0];
  const request = { projectId: project.projectId, expectedRevision: project.revision, operationId: require('node:crypto').randomUUID(), displayName: '新名称' };
  for (const change of [{ displayName: '' }, { displayName: 'a'.repeat(121) }, { displayName: '包含\n换行' }, { expectedRevision: -1 }, { directory: data }]) {
    await assert.rejects(page.evaluate(value => window.agentx.renameProject(value), { ...request, ...change }), /名称或编辑请求无效/);
  }
  await page.evaluate(value => window.agentx.renameProject(value), request);
  await assert.rejects(page.evaluate(value => window.agentx.renameProject(value), { ...request, displayName: '过期名称' }), /已变化或不存在/);
  assert.equal((await page.evaluate(() => window.agentx.getWorkspace())).projects[0].displayName, '新名称');
  const foreignPreload = path.join(data, 'foreign-project-preload.cjs');
  await fs.writeFile(foreignPreload, "const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('foreignClient',{invoke:(channel,value)=>value===null?ipcRenderer.invoke(channel):ipcRenderer.invoke(channel,value)});", 'utf8');
  const denied = await app.evaluate(async ({ BrowserWindow }, { preload, request }) => {
    const product = BrowserWindow.getAllWindows()[0];
    const other = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    try {
      await other.loadURL(product.webContents.getURL());
      const calls = [['agentx:workspace-read', null], ['agentx:project-choose', { operationId: request.operationId }], ['agentx:project-rename', request]];
      return await other.webContents.executeJavaScript(`Promise.all(${JSON.stringify(calls)}.map(([channel,value])=>window.foreignClient.invoke(channel,value).then(()=>false,error=>error.message.includes('拒绝非产品主页面'))))`);
    } finally { other.destroy(); }
  }, { preload: foreignPreload, request });
  assert.deepEqual(denied, [true, true, true]);
});

test('迁移成功：M1-02 模型记录与保存保护标记保留，备份能读出迁移前数据', { timeout: 30000 }, async t => {
  const { app, page, data } = await launch();
  t.after(() => app.close());
  await app.evaluate(({ app }) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite'), path = process.getBuiltinModule('node:path');
    const db = new DatabaseSync(path.join(app.getPath('userData'), 'agentx.db'));
    db.exec(`CREATE TABLE model_catalog (id INTEGER PRIMARY KEY CHECK(id=1), model_ids TEXT NOT NULL, fetched_at TEXT NOT NULL, config_revision INTEGER NOT NULL);
      CREATE TABLE model_tests (operation_id TEXT PRIMARY KEY, model_id TEXT NOT NULL, config_revision INTEGER NOT NULL, credential_ref TEXT NOT NULL, tested_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('passed','failed')), error TEXT);
      CREATE TABLE model_key_save (id INTEGER PRIMARY KEY CHECK(id=1), previous_ref TEXT);
      INSERT INTO model_catalog VALUES (1, '["synthetic-model"]', '2026-09-01T00:00:00.000Z', 7);
      INSERT INTO model_tests VALUES ('synthetic-operation', 'synthetic-model', 7, 'synthetic-reference', '2026-09-01T00:00:00.000Z', 12, 'failed', '合成历史错误');
      INSERT INTO model_key_save VALUES (1, 'synthetic-reference');
      PRAGMA user_version=3;`);
    db.close();
  });
  assert.deepEqual(await page.evaluate(() => window.agentx.getWorkspace()), { projects: [], tasks: [] });
  require('ts-node').register({ transpileOnly: true });
  const { readCatalog, readModelTests, readKeySaveFailure } = require('../../src/main/storage/models.ts');
  assert.deepEqual(readCatalog(data), { modelIds: ['synthetic-model'], fetchedAt: '2026-09-01T00:00:00.000Z', configRevision: 7 });
  assert.equal(readModelTests(data)[0].error, '合成历史错误');
  assert.match(readKeySaveFailure(data, 'synthetic-reference'), /不会使用旧 Key/);
  const backups = (await fs.readdir(data)).filter(name => /^agentx\.before-v14\..+\.db$/.test(name));
  assert.equal(backups.length, 1);
  const original = await app.evaluate((_electron, filename) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const db = new DatabaseSync(filename, { readOnly: true });
    try { return { version: db.prepare('PRAGMA user_version').get().user_version, integrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
      catalog: db.prepare('SELECT model_ids FROM model_catalog').get().model_ids, error: db.prepare('SELECT error FROM model_tests').get().error,
      reference: db.prepare('SELECT previous_ref FROM model_key_save').get().previous_ref }; }
    finally { db.close(); }
  }, path.join(data, backups[0]));
  assert.deepEqual(original, { version: 3, integrity: 'ok', catalog: '["synthetic-model"]', error: '合成历史错误', reference: 'synthetic-reference' });
});

test('侧栏设计 QA：菜单在行外展开，不遮住铅笔；目录失效标记不压住长名称', { timeout: 30000 }, async t => {
  const { app, page, data } = await launch();
  t.after(() => app.close());
  const name = '需要显示失效标记的长项目名称';
  const directory = path.join(data, name); await fs.mkdir(directory);
  await chooseDirectory(app, page, directory);
  await page.getByRole('button', { name: `项目操作：${name}`, exact: true }).focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem');
  const overlaps = await page.evaluate(() => {
    const menu = document.querySelector('.project-menu').getBoundingClientRect();
    const actions = document.querySelector('.project-actions').getBoundingClientRect();
    return menu.left < actions.right && menu.right > actions.left && menu.top < actions.bottom && menu.bottom > actions.top;
  });
  assert.equal(overlaps, false, '菜单不能遮住项目右侧操作');
  assert.equal(await page.locator('.project-actions').evaluate(element => getComputedStyle(element).opacity), '1');
  await page.keyboard.press('Escape');
  const moved = path.join(data, '移动后的测试目录');
  assert.equal(path.dirname(directory), data); assert.equal(path.dirname(moved), data);
  await fs.rename(directory, moved);
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('img', { name: `目录不可用：${name}` }).waitFor();
  assert.equal(await page.evaluate(() => {
    const text = document.querySelector('.project-select span').getBoundingClientRect();
    const marker = document.querySelector('.directory-unavailable').getBoundingClientRect();
    return text.right <= marker.left;
  }), true, '失效标记应有独立空间');
});
