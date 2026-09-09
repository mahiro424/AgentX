const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch, crashTestApp } = require('./helpers.cjs');
const { randomUUID } = require('node:crypto');

test('会话归档：悬停归档隐藏唯一行，保留草稿与执行事实，显式恢复回到置顶区', { timeout: 60000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const taskId = await seedTask(app);
  await page.evaluate(request => window.agentx.setTaskPinned(request), { operationId: randomUUID(), taskId, pinned: true, expectedRevision: 0 });
  const row = page.getByRole('button', { name: '原来的会话名称', exact: true });
  await row.click();
  const draft = page.getByRole('textbox', { name: '任务要求', exact: true });
  await draft.fill('归档后仍保留的补充要求');
  const before = (await page.evaluate(() => window.agentx.getWorkspace())).tasks[0];
  await row.hover();
  await page.getByRole('button', { name: '归档会话：原来的会话名称', exact: true }).click({ timeout: 5000 });
  await row.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '恢复会话', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);
  assert.match(await page.locator('#send-unavailable').innerText(), /归档/);
  assert.equal(await draft.inputValue(), '归档后仍保留的补充要求');
  const archived = (await page.evaluate(() => window.agentx.getWorkspace())).tasks[0];
  assert.equal(typeof archived.archivedAt, 'string');
  assert.deepEqual({ ...archived, archivedAt: before.archivedAt, organizationRevision: before.organizationRevision }, before);
  await page.getByRole('button', { name: '恢复会话', exact: true }).click();
  await page.getByRole('region', { name: '置顶会话', exact: true }).getByRole('button', { name: before.title, exact: true }).waitFor();
  const restored = (await page.evaluate(() => window.agentx.getWorkspace())).tasks[0];
  assert.equal(restored.archivedAt, null);
  assert.deepEqual({ ...restored, organizationRevision: before.organizationRevision }, before);
  assert.equal(await draft.inputValue(), '归档后仍保留的补充要求');
});

async function seedTask(app) {
return app.evaluate(({ app, BrowserWindow }, repository) => {
    const req = process.getBuiltinModule('node:module').createRequire(repository + '/package.json');
    req('ts-node').register({ transpileOnly: true, project: repository + '/tsconfig.json' });
    const root = app.getPath('userData');
    const project = req(repository + '/src/main/storage/projects.ts').associateProject(root, root).project;
    const taskId = process.getBuiltinModule('node:crypto').randomUUID();
    const now = new Date().toISOString();
    req(repository + '/src/main/storage/tasks.ts').createTaskRecord(root, {
      taskId, projectId: project.projectId, directory: root, title: '原来的会话名称',
      lastActivityAt: now, observedAt: now, executionState: 'completed', threadId: 'rename-thread', turnId: 'rename-turn',
    });
    BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed');
    return taskId;
  }, path.resolve('.'));
}

test('归档读取失败：区分已保存与列表未核对，收起侧栏仍可见错误，旧行不误导重复操作', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  await seedTask(app);
  await page.getByRole('button', { name: '原来的会话名称', exact: true }).waitFor();
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('agentx:workspace-read');
    ipcMain.handle('agentx:workspace-read', () => { throw new Error('合成列表读取失败'); });
  });
  await page.getByRole('button', { name: '原来的会话名称', exact: true }).hover();
  await page.getByRole('button', { name: '归档会话：原来的会话名称', exact: true }).click();
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '归档已保存，但列表尚未核对' }).waitFor();
  assert.equal(await page.getByText('已归档会话，原历史和文件仍保留', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '原来的会话名称', exact: true }).count(), 0);
});

test('归档阻断：活动或待核对会话的悬停和菜单禁用，直接 IPC 也拒绝且原记录不变', { timeout: 60000 }, async t => {
  const { app, page } = await launch(); t.after(() => crashTestApp(app));
  const taskId = await seedTask(app);
  for (const state of ['submitting', 'running', 'waitingApproval', 'waitingInput', 'stopping', 'reconciling']) {
    await app.evaluate(({ app, BrowserWindow }, state) => {
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
      const database = new DatabaseSync(app.getPath('userData') + '/agentx.db');
      try { database.prepare('UPDATE tasks SET execution_state=?').run(state); } finally { database.close(); }
      BrowserWindow.getAllWindows()[0].webContents.send('agentx:workspace-changed');
    }, state);
    const before = (await page.evaluate(() => window.agentx.getWorkspace())).tasks[0];
    await assert.rejects(page.evaluate(value => window.agentx.setTaskArchived(value), {
      taskId, operationId: randomUUID(), expectedRevision: before.organizationRevision, archived: true,
    }), /活动|核对/);
    const row = page.getByRole('button', { name: before.title, exact: true });
    await row.hover();
    assert.equal(await page.getByRole('button', { name: `归档会话：${before.title}`, exact: true }).isDisabled(), true);
    await row.press('Shift+F10');
    assert.equal(await page.getByRole('menuitem', { name: '归档会话', exact: true }).isDisabled(), true);
    assert.match(await page.getByRole('menuitem', { name: '归档会话', exact: true }).getAttribute('title'), /停止|核对/);
    await page.getByRole('menu').press('Escape');
    assert.deepEqual((await page.evaluate(() => window.agentx.getWorkspace())).tasks[0], before);
  }
  await app.evaluate(({ app }) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const database = new DatabaseSync(app.getPath('userData') + '/agentx.db');
    try { database.exec("UPDATE tasks SET execution_state='completed'"); } finally { database.close(); }
  });
});

test('会话改名：右键入口保存新标题，重开保留且不改变执行事实', { timeout: 90000 }, async () => {
  let { app, page, data } = await launch();
  try {
    const taskId = await seedTask(app);
    const before = (await page.evaluate(() => window.agentx.getWorkspace())).tasks.find(task => task.taskId === taskId);
    await page.getByRole('button', { name: '原来的会话名称', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: '重命名会话', exact: true }).click();
    const name = page.getByRole('textbox', { name: '会话名称', exact: true });
    await name.fill('整理季度报告');
    await name.press('Enter');
    await page.getByRole('dialog', { name: '重命名会话', exact: true }).waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '整理季度报告', exact: true }).waitFor();
    const updated = (await page.evaluate(() => window.agentx.getWorkspace())).tasks.find(task => task.taskId === taskId);
    assert.equal(updated.title, '整理季度报告');
    assert.equal(updated.organizationRevision, before.organizationRevision + 1);
    assert.deepEqual({ ...updated, title: before.title, organizationRevision: before.organizationRevision }, before);
    await app.close();
    ({ app, page } = await launch(data));
    await page.getByRole('button', { name: '整理季度报告', exact: true }).waitFor();
    assert.deepEqual((await page.evaluate(() => window.agentx.getWorkspace())).tasks.find(task => task.taskId === taskId), updated);
  } finally { await app.close(); }
});


test('会话编辑冲突：旧修订保存失败保留输入，Escape 返回触发处，标题菜单可重新编辑', { timeout: 60000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const taskId = await seedTask(app);
  const row = page.getByRole('button', { name: '原来的会话名称', exact: true });
  await row.focus(); await row.press('Shift+F10');
  await page.getByRole('menuitem', { name: '重命名会话', exact: true }).press('Enter');
  const name = page.getByRole('textbox', { name: '会话名称', exact: true });
  await name.fill('保留我的输入');
  await page.evaluate(request => window.agentx.renameTask(request), { operationId: randomUUID(), taskId, expectedRevision: 0, title: '另一次已保存的名称' });
  await name.press('Enter');
  await page.getByRole('alert').filter({ hasText: '已被其他操作更新' }).waitFor();
  assert.equal(await name.inputValue(), '保留我的输入');
  const current = (await page.evaluate(() => window.agentx.getWorkspace())).tasks[0];
  assert.equal(current.title, '另一次已保存的名称'); assert.equal(current.organizationRevision, 1);
  await name.press('Escape');
  const renamed = page.getByRole('button', { name: current.title, exact: true });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '另一次已保存的名称');
  await renamed.click();
  await page.getByRole('button', { name: '会话操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '重命名会话', exact: true }).click();
  await name.fill('保留我的输入'); await name.press('Enter');
  await page.getByRole('dialog', { name: '重命名会话', exact: true }).waitFor({ state: 'hidden' });
  assert.equal((await page.evaluate(() => window.agentx.getWorkspace())).tasks[0].title, '保留我的输入');
});


test('会话编辑过长：不静默截断名称，拒绝保存且保留完整输入和原记录', { timeout: 30000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  await seedTask(app);
  await page.getByRole('button', { name: '原来的会话名称', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '重命名会话', exact: true }).click();
  const name = page.getByRole('textbox', { name: '会话名称', exact: true });
  const longTitle = '名称'.repeat(251);
  await name.fill(longTitle);
  assert.equal(await name.inputValue(), longTitle);
  await name.press('Enter');
  await page.getByRole('alert').filter({ hasText: '1 至 500' }).waitFor();
  assert.equal(await name.inputValue(), longTitle);
  const task = (await page.evaluate(() => window.agentx.getWorkspace())).tasks[0];
  assert.equal(task.title, '原来的会话名称'); assert.equal(task.organizationRevision, 0);
});


test('会话改名 IPC：非法请求无副作用，原修订重复提交不能再次改写', { timeout: 30000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const taskId = await seedTask(app);
  const before = (await page.evaluate(() => window.agentx.getWorkspace())).tasks[0];
  const request = { operationId: randomUUID(), taskId, expectedRevision: 0, title: '有效名称' };
  for (const value of [null, [], { ...request, taskId: 'invalid' }, { ...request, operationId: 'invalid' },
    { ...request, expectedRevision: -1 }, { ...request, expectedRevision: 0.5 }, { ...request, expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { ...request, title: '' }, { ...request, title: '  ' }, { ...request, title: '名'.repeat(501) },
    { ...request, title: '错误\n名称' }, { ...request, executionState: 'completed' }]) {
    await assert.rejects(page.evaluate(value => window.agentx.renameTask(value), value), /名称或编辑请求无效/);
    assert.deepEqual((await page.evaluate(() => window.agentx.getWorkspace())).tasks[0], before);
  }
  const saved = await page.evaluate(value => window.agentx.renameTask(value), { ...request, title: '  有效名称  ' });
  assert.equal(saved.title, '有效名称'); assert.equal(saved.organizationRevision, 1);
  await assert.rejects(page.evaluate(value => window.agentx.renameTask(value), request), /已被其他操作更新/);
  assert.deepEqual((await page.evaluate(() => window.agentx.getWorkspace())).tasks[0], saved);
});

test('会话编辑 IME：组合输入 Enter/Escape 不提交或关闭，结束组合后可取消且恢复焦点', { timeout: 30000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  await seedTask(app);
  const row = page.getByRole('button', { name: '原来的会话名称', exact: true });
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '重命名会话', exact: true }).click();
  const name = page.getByRole('textbox', { name: '会话名称', exact: true });
  await name.fill('组合输入中的名称');
  await name.dispatchEvent('compositionstart', { data: '名称' });
  await name.press('Enter'); await name.press('Escape');
  assert.equal(await page.getByRole('dialog', { name: '重命名会话', exact: true }).isVisible(), true);
  assert.equal(await name.inputValue(), '组合输入中的名称');
  assert.equal((await page.evaluate(() => window.agentx.getWorkspace())).tasks[0].organizationRevision, 0);
  await name.dispatchEvent('compositionend', { data: '名称' });
  await name.press('Escape');
  await page.getByRole('dialog', { name: '重命名会话', exact: true }).waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '原来的会话名称');
});


test('v9 会话升级：打包应用先备份旧结构，原会话保留，首次改名从组织修订零开始', { timeout: 60000 }, async () => {
  const fs = require('node:fs/promises');
  const { DatabaseSync } = require('node:sqlite');
  let { app, page, data } = await launch();
  try {
    await seedTask(app);
    const before = (await page.evaluate(() => window.agentx.getWorkspace())).tasks[0];
    await app.close();
    const old = new DatabaseSync(path.join(data, 'agentx.db'));
    try { old.exec('ALTER TABLE tasks DROP COLUMN archived_at; ALTER TABLE tasks DROP COLUMN pinned_at; ALTER TABLE tasks DROP COLUMN organization_revision; PRAGMA user_version=9'); }
    finally { old.close(); }
    ({ app, page } = await launch(data));
    await page.getByRole('button', { name: before.title, exact: true }).waitFor();
    assert.deepEqual((await page.evaluate(() => window.agentx.getWorkspace())).tasks[0], before);
    const backups = (await fs.readdir(data)).filter(name => /^agentx\.before-v13\..+\.db$/.test(name));
    assert.equal(backups.length, 1);
    const backup = new DatabaseSync(path.join(data, backups[0]), { readOnly: true });
    try {
      assert.equal(backup.prepare('PRAGMA user_version').get().user_version, 9);
      assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.equal(backup.prepare('PRAGMA table_info(tasks)').all().some(column => column.name === 'organization_revision'), false);
      assert.equal(backup.prepare('SELECT title FROM tasks').get().title, before.title);
    } finally { backup.close(); }
    const saved = await page.evaluate(value => window.agentx.renameTask(value), { operationId: randomUUID(), taskId: before.taskId, expectedRevision: 0, title: '升级后编辑' });
    assert.equal(saved.organizationRevision, 1);
    assert.deepEqual({ ...saved, title: before.title, organizationRevision: 0 }, before);
  } finally { await app.close(); }
});


test('会话编辑写入失败：真实数据库占用时保留输入，释放后显式保存成功', { timeout: 30000 }, async t => {
  const { DatabaseSync } = require('node:sqlite');
  const { app, page, data } = await launch(); t.after(() => app.close());
  await seedTask(app);
  await page.getByRole('button', { name: '原来的会话名称', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '重命名会话', exact: true }).click();
  const name = page.getByRole('textbox', { name: '会话名称', exact: true });
  await name.fill('保留到可以保存为止');
  const lock = new DatabaseSync(path.join(data, 'agentx.db'));
  try {
    lock.exec('BEGIN IMMEDIATE');
    await name.press('Enter');
    await page.getByRole('alert').filter({ hasText: '数据库正在被占用' }).waitFor();
    assert.equal(await name.inputValue(), '保留到可以保存为止');
    assert.equal((await page.evaluate(() => window.agentx.getWorkspace())).tasks[0].title, '原来的会话名称');
  } finally { lock.exec('ROLLBACK'); lock.close(); }
  await name.press('Enter');
  await page.getByRole('dialog', { name: '重命名会话', exact: true }).waitFor({ state: 'hidden' });
  assert.equal((await page.evaluate(() => window.agentx.getWorkspace())).tasks[0].title, '保留到可以保存为止');
});


test('会话置顶：悬停动作移到唯一置顶行，重开保持，键盘菜单取消后回归原项目', { timeout: 60000 }, async () => {
  let { app, page, data } = await launch();
  try {
    const taskId = await seedTask(app);
    const before = (await page.evaluate(() => window.agentx.getWorkspace())).tasks[0];
    const row = page.getByRole('button', { name: before.title, exact: true });
    await row.hover();
    await page.getByRole('button', { name: `置顶会话：${before.title}`, exact: true }).click();
    const pinned = page.getByRole('region', { name: '置顶会话', exact: true });
    await pinned.getByRole('button', { name: before.title, exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: before.title, exact: true }).count(), 1);
    const saved = (await page.evaluate(() => window.agentx.getWorkspace())).tasks[0];
    assert.equal(saved.organizationRevision, before.organizationRevision + 1);
    assert.ok(Number.isFinite(Date.parse(saved.pinnedAt)));
    assert.deepEqual({ ...saved, pinnedAt: before.pinnedAt, organizationRevision: before.organizationRevision }, before);
    await app.close(); ({ app, page } = await launch(data));
    const pinnedAgain = page.getByRole('region', { name: '置顶会话', exact: true });
    const pinnedRow = pinnedAgain.getByRole('button', { name: before.title, exact: true });
    await pinnedRow.focus(); await pinnedRow.press('Shift+F10');
    await page.getByRole('menuitem', { name: '重命名会话', exact: true }).press('ArrowDown');
    await page.getByRole('menuitem', { name: '取消置顶会话', exact: true }).press('Enter');
    await pinnedAgain.waitFor({ state: 'hidden' });
    const snapshot = await page.evaluate(() => window.agentx.getWorkspace());
    await page.getByRole('region', { name: `项目：${snapshot.projects[0].displayName}`, exact: true }).getByRole('button', { name: before.title, exact: true }).waitFor();
    assert.equal(snapshot.tasks[0].taskId, taskId); assert.equal(snapshot.tasks[0].pinnedAt, null);
    assert.equal(snapshot.tasks[0].organizationRevision, saved.organizationRevision + 1);
    assert.equal(snapshot.tasks[0].lastActivityAt, before.lastActivityAt);
    assert.equal(await page.getByRole('button', { name: before.title, exact: true }).count(), 1);
  } finally { await app.close(); }
});


test('会话置顶 IPC：非法参数和旧修订不能置顶或取消，也不能覆盖并发改名', { timeout: 30000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const taskId = await seedTask(app);
  const before = (await page.evaluate(() => window.agentx.getWorkspace())).tasks[0];
  const request = { taskId, operationId: randomUUID(), expectedRevision: 0, pinned: true };
  for (const invalid of [null, [], { ...request, pinned: 'true' }, { ...request, taskId: 'invalid' },
    { ...request, operationId: 'invalid' }, { ...request, expectedRevision: -1 }, { ...request, expectedRevision: 0.5 },
    { ...request, executionState: 'completed' }]) {
    await assert.rejects(page.evaluate(value => window.agentx.setTaskPinned(value), invalid), /会话置顶请求无效/);
    assert.deepEqual((await page.evaluate(() => window.agentx.getWorkspace())).tasks[0], before);
  }
  const saved = await page.evaluate(value => window.agentx.setTaskPinned(value), request);
  await assert.rejects(page.evaluate(value => window.agentx.setTaskPinned(value), { ...request, pinned: false }), /已被其他操作更新/);
  await assert.rejects(page.evaluate(value => window.agentx.renameTask(value), { taskId, operationId: randomUUID(), expectedRevision: 0, title: '旧修订覆盖' }), /已被其他操作更新/);
  assert.deepEqual((await page.evaluate(() => window.agentx.getWorkspace())).tasks[0], saved);
  assert.deepEqual({ ...saved, archivedAt: null, pinnedAt: null, organizationRevision: 0 }, before);
});

test('v10 会话升级：先备份已改名的组织修订，置顶后不重置原修订或执行事实', { timeout: 60000 }, async () => {
  const fs = require('node:fs/promises');
  const { DatabaseSync } = require('node:sqlite');
  let { app, page, data } = await launch();
  try {
    const taskId = await seedTask(app);
    const before = await page.evaluate(value => window.agentx.renameTask(value), { taskId, operationId: randomUUID(), expectedRevision: 0, title: '升级前已改过名' });
    await app.close();
    const old = new DatabaseSync(path.join(data, 'agentx.db'));
    try { old.exec('ALTER TABLE tasks DROP COLUMN archived_at; ALTER TABLE tasks DROP COLUMN pinned_at; PRAGMA user_version=10'); } finally { old.close(); }
    ({ app, page } = await launch(data));
    await page.getByRole('button', { name: before.title, exact: true }).waitFor();
    assert.deepEqual((await page.evaluate(() => window.agentx.getWorkspace())).tasks[0], before);
    const backups = (await fs.readdir(data)).filter(name => /^agentx\.before-v13\..+\.db$/.test(name));
    assert.equal(backups.length, 1);
    const original = new DatabaseSync(path.join(data, backups[0]), { readOnly: true });
    try {
      assert.equal(original.prepare('PRAGMA user_version').get().user_version, 10);
      assert.equal(original.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.equal(original.prepare('SELECT organization_revision FROM tasks').get().organization_revision, 1);
      assert.equal(original.prepare('PRAGMA table_info(tasks)').all().some(column => column.name === 'pinned_at'), false);
    } finally { original.close(); }
    const saved = await page.evaluate(value => window.agentx.setTaskPinned(value), { taskId, operationId: randomUUID(), expectedRevision: 1, pinned: true });
    assert.equal(saved.organizationRevision, 2);
    assert.deepEqual({ ...saved, organizationRevision: 1, pinnedAt: null }, before);
  } finally { await app.close(); }
});

test('v11 升级与归档重开：备份原置顶和组织修订，历史关联与原文件保留，显式恢复不执行', { timeout: 60000 }, async () => {
  const fs = require('node:fs/promises');
  const { DatabaseSync } = require('node:sqlite');
  let { app, page, data } = await launch();
  try {
    const taskId = await seedTask(app);
    const before = await page.evaluate(value => window.agentx.setTaskPinned(value), { taskId, operationId: randomUUID(), expectedRevision: 0, pinned: true });
    const source = path.join(data, '人工原件.txt'); await fs.writeFile(source, '人工原件，不得删除或改写\n', 'utf8');
    await app.close();
    const old = new DatabaseSync(path.join(data, 'agentx.db'));
    try { old.exec('ALTER TABLE tasks DROP COLUMN archived_at; PRAGMA user_version=11'); } finally { old.close(); }
    ({ app, page } = await launch(data));
    assert.deepEqual((await page.evaluate(() => window.agentx.getWorkspace())).tasks[0], before);
    const backups = (await fs.readdir(data)).filter(name => /^agentx\.before-v13\..+\.db$/.test(name));
    assert.equal(backups.length, 1);
    const original = new DatabaseSync(path.join(data, backups[0]), { readOnly: true });
    try {
      assert.equal(original.prepare('PRAGMA user_version').get().user_version, 11);
      assert.equal(original.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      const row = original.prepare('SELECT * FROM tasks').get();
      assert.equal(row.organization_revision, before.organizationRevision); assert.equal(row.pinned_at, before.pinnedAt);
      assert.equal(original.prepare('PRAGMA table_info(tasks)').all().some(column => column.name === 'archived_at'), false);
    } finally { original.close(); }
    await page.getByRole('button', { name: before.title, exact: true }).press('Shift+F10');
    await page.getByRole('menuitem', { name: '重命名会话', exact: true }).press('End');
    await page.getByRole('menuitem', { name: '归档会话', exact: true }).press('Enter');
    await page.getByRole('button', { name: '撤销归档', exact: true }).waitFor();
    const archived = (await page.evaluate(() => window.agentx.getWorkspace())).tasks[0];
    assert.ok(archived.archivedAt);
    await app.close(); ({ app, page } = await launch(data));
    assert.deepEqual((await page.evaluate(() => window.agentx.getWorkspace())).tasks[0], archived);
    assert.equal(await page.getByRole('button', { name: before.title, exact: true }).count(), 0);
    const restored = await page.evaluate(value => window.agentx.setTaskArchived(value),
      { taskId, operationId: randomUUID(), expectedRevision: archived.organizationRevision, archived: false });
    await page.getByRole('button', { name: before.title, exact: true }).waitFor();
    assert.deepEqual({ ...restored, organizationRevision: before.organizationRevision }, before);
    assert.equal((await page.evaluate(() => window.agentx.getExecution())).task, null);
    assert.equal(await fs.readFile(source, 'utf8'), '人工原件，不得删除或改写\n');
  } finally { await app.close(); }
});
