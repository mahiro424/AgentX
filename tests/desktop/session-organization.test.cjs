const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch } = require('./helpers.cjs');
const { randomUUID } = require('node:crypto');

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
    try { old.exec('ALTER TABLE tasks DROP COLUMN organization_revision; PRAGMA user_version=9'); }
    finally { old.close(); }
    ({ app, page } = await launch(data));
    await page.getByRole('button', { name: before.title, exact: true }).waitFor();
    assert.deepEqual((await page.evaluate(() => window.agentx.getWorkspace())).tasks[0], before);
    const backups = (await fs.readdir(data)).filter(name => /^agentx\.before-v10\..+\.db$/.test(name));
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
