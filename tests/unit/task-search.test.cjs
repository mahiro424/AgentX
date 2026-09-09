const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
require('ts-node').register({ transpileOnly: true });

async function fixture() {
  const base = path.resolve('.local-validation/m2-01'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'search-'));
  const { associateProject, readWorkspace } = require('../../src/main/storage/projects.ts');
  const { createTaskRecord } = require('../../src/main/storage/tasks.ts');
  const project = associateProject(root, root).project, now = new Date().toISOString();
  const task = { taskId: randomUUID(), projectId: project.projectId, directory: root, title: '整理经营记录',
    executionState: 'completed', threadId: 'search-thread', turnId: 'search-turn', lastActivityAt: now, observedAt: now };
  createTaskRecord(root, task);
  const before = readWorkspace(root);
  const history = { taskId: task.taskId, threadId: task.threadId, turns: [{ turnId: task.turnId, status: 'completed',
    unrepresentedItemTypes: [], items: [
      { kind: 'userMessage', threadId: task.threadId, turnId: task.turnId, itemId: 'user-1', text: '请核对季度收入。' },
      { kind: 'message', threadId: task.threadId, turnId: task.turnId, itemId: 'answer-1', text: '季度收入已经汇总。', status: 'completed', phase: 'final_answer' },
    ] }] };
  const calls = [];
  const { TaskSearchService } = require('../../src/main/services/task-search.ts');
  const service = new TaskSearchService(root, async request => { calls.push(request); return history; });
  return { root, task, history, before, calls, service, TaskSearchService, readWorkspace };
}

test('正文搜索：从公开可见历史建立可重建投影，命中保留来源，重开检索不改变执行和组织', async () => {
  const { root, task, before, calls, service, TaskSearchService, readWorkspace } = await fixture();
  const request = { query: '季度收入', scope: 'all', projectId: null, includeArchived: false };
  const pending = await service.query(request);
  assert.equal(pending.results.length, 0); assert.equal(pending.coverage.coveredTasks, 0);
  assert.equal(pending.coverage.totalTasks, 1);
  await service.rebuild();
  assert.deepEqual(calls, [{ taskId: task.taskId }]);
  const result = await service.query(request);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].taskId, task.taskId); assert.equal(result.results[0].title, task.title);
  assert.equal(result.results[0].match, 'body');
  assert.equal(result.results[0].snippet.text, '请核对季度收入。');
  assert.deepEqual(result.results[0].snippet.ranges, [[3, 7]]);
  assert.deepEqual(result.results[0].source, { threadId: task.threadId, turnId: task.turnId, itemId: 'user-1',
    sourceRevision: result.results[0].source.sourceRevision });
  assert.match(result.results[0].source.sourceRevision, /^[a-f0-9]{64}$/);
  assert.equal(result.coverage.coveredTasks, 1);
  const reopened = new TaskSearchService(root, async () => { throw new Error('查询不得重新启动历史读取或执行'); });
  assert.deepEqual(await reopened.query(request), result);
  assert.deepEqual(readWorkspace(root), before);
  assert.ok((await fs.stat(path.join(root, 'cache', 'search.sqlite'))).isFile());
});

test('搜索隐私：只投影可见字段，剔除已识别密钥与认证头，不读取附件文件或隐藏推理', async () => {
  const f = await fixture();
  const secret = 'sk-' + 's'.repeat(32), bearer = 'syntheticBearerCredential', cookie = 'syntheticCookieValue';
  await fs.writeFile(path.join(f.root, 'private-notes.txt'), '附件独有隐私标记，不得全文索引', 'utf8');
  const item = f.history.turns[0].items[0];
  item.text = `正常用户记录，密钥 ${secret}\nAuthorization: Bearer ${bearer}\nCookie: sid=${cookie}\napi_key=syntheticNamedSecret\n文件：${path.join(f.root, 'private-notes.txt')}`;
  item.reasoning = '隐藏推理独有标记';
  item.attachments = [{ content: '附件元数据全文标记' }];
  await f.service.rebuild();
  const query = text => f.service.query({ query: text, scope: 'body', projectId: null, includeArchived: false });
  for (const text of [secret, bearer, cookie, 'syntheticNamedSecret', '隐藏推理独有标记', '附件元数据全文标记', '附件独有隐私标记']) {
    assert.equal((await query(text)).results.length, 0, `不可检索：${text}`);
    assert.equal((await fs.readFile(path.join(f.root, 'cache', 'search.sqlite'))).includes(Buffer.from(text)), false);
  }
  const visible = await query('正常用户记录');
  assert.equal(visible.results.length, 1); assert.match(visible.results[0].snippet.text, /正常用户记录/);
  assert.deepEqual(f.readWorkspace(f.root), f.before);
});

test('材料搜索隐私：真实材料使用后，工具输出和助手引用不自动进入正文索引，用户要求仍可定位', async () => {
  const f = await fixture();
  const { MaterialService } = require('../../src/main/services/materials.ts');
  const { bindInputMaterials } = require('../../src/main/storage/materials.ts');
  const { withDatabase } = require('../../src/main/storage/database.ts');
  const filename = path.join(f.root, 'private-material.txt'); await fs.writeFile(filename, '材料独有正文');
  const records = await new MaterialService(f.root).register([filename]);
  withDatabase(f.root, db => bindInputMaterials(db, f.task.taskId, randomUUID(), { revision: 1, records }, 'steer', f.task.turnId));
  f.history.turns[0].items[1].text = '材料独有正文';
  await f.service.rebuild();
  const query = query => f.service.query({ query, scope: 'body', projectId: null, includeArchived: false });
  assert.equal((await query('材料独有正文')).results.length, 0);
  const visible = await query('请核对季度收入'); assert.equal(visible.results.length, 1);
  assert.match(visible.coverage.issues[0].reason, /材料/);
  assert.equal((await fs.readFile(path.join(f.root, 'cache', 'search.sqlite'))).includes(Buffer.from('材料独有正文')), false);
  assert.equal((await f.service.locate({ taskId: f.task.taskId, ...visible.results[0].source })).history.taskId, f.task.taskId);
});

test('搜索缓存归属：拒绝目录链接和数据库硬链接，查询与重建均不改变外部缓存', async () => {
  for (const mode of ['directory', 'hardlink', 'journal', 'wal', 'shm']) {
    const f = await fixture(), external = await fixture();
    await external.service.rebuild();
    const externalCache = path.join(external.root, 'cache'), externalFile = path.join(externalCache, 'search.sqlite');
    const before = await fs.readFile(externalFile);
    if (mode === 'directory') await fs.symlink(externalCache, path.join(f.root, 'cache'), 'junction');
    else {
      await fs.mkdir(path.join(f.root, 'cache'));
      await fs.link(externalFile, path.join(f.root, 'cache', mode === 'hardlink' ? 'search.sqlite' : `search.sqlite-${mode}`));
    }
    await assert.rejects(f.service.query({ query: '季度收入', scope: 'body', projectId: null, includeArchived: false }), /缓存|索引/);
    await assert.rejects(f.service.rebuild(), /缓存|索引/);
    assert.deepEqual(await fs.readFile(externalFile), before, `${mode} 不得写入外部目标`);
    assert.deepEqual(f.readWorkspace(f.root), f.before);
    assert.equal(f.calls.length, 0, '缓存路径未通过核验时不启动原历史读取');
  }
});

test('源历史缺失：重建保留旧命中但明确不可定位与部分覆盖，恢复后显式重试才能更新', async () => {
  const f = await fixture(); await f.service.rebuild();
  const request = { query: '季度收入', scope: 'body', projectId: null, includeArchived: false };
  const before = await f.service.query(request);
  const missing = new f.TaskSearchService(f.root, async () => { throw new Error('合成原历史已不可读取'); });
  await missing.rebuild();
  const result = await missing.query(request);
  assert.equal(result.results.length, 1); assert.equal(result.results[0].snippet.text, before.results[0].snippet.text);
  assert.match(result.results[0].sourceError, /原历史已不可读取/);
  assert.equal(result.coverage.coveredTasks, 0); assert.equal(result.coverage.issues.length, 1);
  assert.match(result.coverage.issues[0].reason, /原历史已不可读取/);
  const reopened = new f.TaskSearchService(f.root, async () => f.history);
  assert.deepEqual(await reopened.query(request), result);
  await reopened.rebuild();
  assert.deepEqual(await reopened.query(request), before);
  assert.deepEqual(f.readWorkspace(f.root), f.before);
});

test('损坏索引恢复：查询先报错，显式重建保留损坏文件并恢复真实来源，不改产品数据', async () => {
  const f = await fixture(); await f.service.rebuild();
  const cache = path.join(f.root, 'cache'), file = path.join(cache, 'search.sqlite');
  const damaged = Buffer.from('合成损坏的搜索索引，必须保留诊断证据');
  const productBefore = await fs.readFile(path.join(f.root, 'agentx.db'));
  await fs.writeFile(file, damaged);
  const request = { query: '季度收入', scope: 'body', projectId: null, includeArchived: false };
  await assert.rejects(f.service.query(request), /索引/);
  assert.deepEqual(await fs.readFile(file), damaged, '读取失败不能偷偷清库');
  await f.service.rebuild();
  const result = await f.service.query(request);
  assert.equal(result.results.length, 1); assert.equal(result.coverage.coveredTasks, 1);
  const source = result.results[0].source;
  assert.equal((await f.service.locate({ taskId: f.task.taskId, ...source })).source.itemId, 'user-1');
  assert.match(f.service.getIndexState().notice, /损坏.*保留/);
  const preserved = (await fs.readdir(cache)).filter(name => /^search\.damaged-.*\.sqlite$/.test(name));
  assert.equal(preserved.length, 1); assert.deepEqual(await fs.readFile(path.join(cache, preserved[0])), damaged);
  assert.deepEqual(await fs.readFile(path.join(f.root, 'agentx.db')), productBefore);
  assert.deepEqual(f.readWorkspace(f.root), f.before);
});

test('损坏索引保留失败：回滚成功或部分保留均明确报告，不继续重建或丢失证据', async t => {
  const sync = require('node:fs');
  for (const rollbackFails of [false, true]) {
    const f = await fixture(); await f.service.rebuild();
    const cache = path.join(f.root, 'cache'), file = path.join(cache, 'search.sqlite');
    const damaged = Buffer.from('合成损坏库'), sidecar = Buffer.from('合成共享内存');
    await fs.writeFile(file, damaged); await fs.writeFile(`${file}-shm`, sidecar);
    const rename = sync.renameSync;
    const mock = t.mock.method(sync, 'renameSync', (from, to) => {
      if (from === `${file}-shm` || (rollbackFails && to === file)) throw Object.assign(new Error('合成文件权限拒绝'), { code: 'EACCES' });
      return rename(from, to);
    });
    try {
      await assert.rejects(f.service.rebuild(), rollbackFails ? /部分文件仍在.*保留位置.*未开始重建/ : /已恢复原位置.*未开始重建/);
    } finally { mock.mock.restore(); }
    assert.equal(f.calls.length, 1, '保留未完成，不得再读取引擎建立新索引');
    const preserved = (await fs.readdir(cache)).filter(name => /^search\.damaged-.*\.sqlite$/.test(name));
    assert.equal(preserved.length, rollbackFails ? 1 : 0);
    assert.deepEqual(await fs.readFile(rollbackFails ? path.join(cache, preserved[0]) : file), damaged);
    assert.deepEqual(await fs.readFile(`${file}-shm`), sidecar);
    assert.deepEqual(f.readWorkspace(f.root), f.before);
  }
});

test('索引结构缺失：已知版本缺少表时可显式重建，未知版本和独占锁不得触发替换', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const f = await fixture(); await f.service.rebuild();
  const file = path.join(f.root, 'cache', 'search.sqlite');
  let db = new DatabaseSync(file); db.exec('DROP TABLE search_items'); db.close();
  await f.service.rebuild();
  assert.equal((await f.service.query({ query: '季度收入', scope: 'body', projectId: null, includeArchived: false })).results.length, 1);
  const preserved = () => fs.readdir(path.join(f.root, 'cache'));
  const beforeFiles = await preserved();
  db = new DatabaseSync(file); db.exec('PRAGMA user_version=99'); db.close();
  const future = await fs.readFile(file);
  await assert.rejects(f.service.rebuild(), /核验|版本|索引/);
  assert.deepEqual(await fs.readFile(file), future); assert.deepEqual(await preserved(), beforeFiles);
  db = new DatabaseSync(file); db.exec('PRAGMA user_version=1; BEGIN EXCLUSIVE');
  try { await assert.rejects(f.service.rebuild(), /核验|索引/); }
  finally { db.exec('ROLLBACK'); db.close(); }
  assert.deepEqual(await preserved(), beforeFiles);
  assert.deepEqual(f.readWorkspace(f.root), f.before);
});

test('历史覆盖：隐藏推理不计入缺口，尚不支持的可见类型明确部分覆盖，已索引项仍有来源', async () => {
  const f = await fixture();
  f.history.turns[0].unrepresentedItemTypes = ['reasoning'];
  await f.service.rebuild();
  const request = { query: '季度收入', scope: 'body', projectId: null, includeArchived: false };
  assert.equal((await f.service.query(request)).coverage.coveredTasks, 1);
  f.history.turns[0].unrepresentedItemTypes.push('mcpToolCall');
  await f.service.rebuild();
  const result = await f.service.query(request);
  assert.equal(result.coverage.coveredTasks, 0);
  assert.match(result.coverage.issues[0].reason, /尚不支持.*mcpToolCall/);
  assert.equal(result.results[0].sourceError, null);
  assert.equal(result.results[0].source.itemId, 'user-1');
});

test('命中定位：重新读取公开历史，拒绝伪造来源和变更片段，显式重建后定位精确消息', async () => {
  const f = await fixture(); await f.service.rebuild();
  const request = { query: '季度收入', scope: 'body', projectId: null, includeArchived: false };
  const hit = (await f.service.query(request)).results[0];
  const target = { taskId: f.task.taskId, ...hit.source };
  const location = await f.service.locate(target);
  assert.deepEqual(location.history, f.history); assert.deepEqual(location.source, hit.source);
  assert.equal(location.taskId, f.task.taskId); assert.equal(f.calls.length, 2);
  for (const invalid of [{ ...target, itemId: 'not-indexed' }, { ...target, taskId: randomUUID() }, { ...target, sourceRevision: '0'.repeat(64) }]) {
    await assert.rejects(f.service.locate(invalid), /来源|任务|命中/);
  }
  assert.equal(f.calls.length, 2, '未验证来源不得调用历史接口');
  f.history.turns[0].items[0].text = '请重新核对季度收入，原文已经变化。';
  await assert.rejects(f.service.locate(target), /已变化/);
  const stale = await f.service.query(request);
  assert.equal(stale.results[0].snippet.text, hit.snippet.text); assert.match(stale.results[0].sourceError, /已变化/);
  assert.equal(stale.coverage.coveredTasks, 0);
  await f.service.rebuild();
  const fresh = (await f.service.query(request)).results[0];
  assert.notEqual(fresh.source.sourceRevision, target.sourceRevision);
  const verified = await f.service.locate({ taskId: f.task.taskId, ...fresh.source });
  assert.equal(verified.history.turns[0].items.find(item => item.itemId === verified.source.itemId).text, '请重新核对季度收入，原文已经变化。');
  assert.deepEqual(f.readWorkspace(f.root), f.before);
});

test('索引重建：重复请求复用同一次只读工作，覆盖进度可观察，退出停止后续读取', async () => {
  const f = await fixture();
  const { createTaskRecord } = require('../../src/main/storage/tasks.ts');
  const second = { ...f.task, taskId: randomUUID(), threadId: 'search-thread-2', turnId: 'search-turn-2', title: '第二个合成会话' };
  createTaskRecord(f.root, second);
  let finish, calls = 0;
  const changes = [];
  const service = new f.TaskSearchService(f.root, async request => {
    calls++; await new Promise(resolve => { finish = resolve; });
    const task = request.taskId === second.taskId ? second : f.task;
    return { taskId: task.taskId, threadId: task.threadId, turns: f.history.turns.map(turn => ({ ...turn,
      turnId: task.turnId, items: turn.items.map(item => ({ ...item, threadId: task.threadId, turnId: task.turnId })) })) };
  }, () => changes.push(service.getIndexState()));
  assert.deepEqual(service.getIndexState(), { running: false, processed: 0, total: 0, error: null });
  const first = service.rebuild(), duplicate = service.rebuild();
  assert.equal(calls, 1); assert.equal(service.getIndexState().running, true);
  assert.equal(service.getIndexState().total, 2);
  const paused = service.pause(); finish();
  await Promise.all([first, duplicate, paused]);
  assert.equal(calls, 1, '退出不启动下一会话的历史读取');
  assert.equal(service.getIndexState().running, false); assert.equal(service.getIndexState().processed, 1);
  assert.match(service.getIndexState().error, /未完成|暂停/);
  assert.ok(changes.some(state => state.running && state.processed === 1));
  await assert.rejects(service.rebuild(), /退出|暂停/);
  service.resume();
  const next = service.rebuild(); finish();
  while (calls !== 3) await new Promise(resolve => setImmediate(resolve));
  finish(); await next;
  assert.deepEqual(service.getIndexState(), { running: false, processed: 2, total: 2, error: null });
  assert.equal((await service.query({ query: '', scope: 'all', projectId: null, includeArchived: false })).coverage.coveredTasks, 2);
});

test('索引自动补齐：首次打开补齐缺口，当前轮更新合并读取且重开可搜，不修改会话活动时间', async t => {
  const f = await fixture();
  let notifications = 0;
  const service = new f.TaskSearchService(f.root, async request => { f.calls.push(request); return structuredClone(f.history); }, () => { notifications++; });
  t.after(() => service.pause());
  const request = { query: '新到达中文消息', scope: 'body', projectId: null, includeArchived: false };
  const waitIndexed = async predicate => {
    const end = Date.now() + 5000;
    while (!predicate()) { assert.ok(Date.now() < end, '自动索引未及时完成'); await new Promise(resolve => setTimeout(resolve, 20)); }
  };
  service.ensureIndex(); service.ensureIndex();
  await waitIndexed(() => f.calls.length === 1 && !service.getIndexState().running);
  assert.equal((await service.query(request)).coverage.coveredTasks, 1);
  f.history.turns[0].items.push({ kind: 'message', threadId: f.task.threadId, turnId: f.task.turnId, itemId: 'new-visible-item', text: request.query, status: 'running', phase: 'commentary' });
  for (let count = 0; count < 10; count++) service.refreshTask(f.task.taskId);
  await waitIndexed(() => f.calls.length === 2 && !service.getIndexState().running);
  const result = await service.query(request);
  assert.equal(result.results[0].source.itemId, 'new-visible-item');
  assert.deepEqual(f.readWorkspace(f.root), f.before);
  const reopened = new f.TaskSearchService(f.root, async () => assert.fail('已有覆盖不重新读取'));
  reopened.ensureIndex();
  assert.deepEqual(await reopened.query(request), result);
  assert.ok(notifications >= 2);
  service.refreshTask(f.task.taskId); await service.pause();
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(f.calls.length, 2, '退出必须取消尚未派发的索引更新');
});

test('字面高亮：中文、ASCII 大小写、标点与 emoji 一致，片段内重复命中全部标记', async () => {
  const f = await fixture();
  f.history.turns[0].items[0].text = '😀季度 A+B_100% 中文季度 a+b_100% 😀';
  await f.service.rebuild();
  for (const [query, matches] of [['季度', ['季度', '季度']], ['a+b_100%', ['A+B_100%', 'a+b_100%']], ['😀', ['😀', '😀']], ['_100%', ['_100%', '_100%']]]) {
    const response = await f.service.query({ query, scope: 'body', projectId: null, includeArchived: false });
    const result = response.results[0];
    assert.equal(result.source.itemId, 'user-1');
    assert.deepEqual(result.snippet.ranges.map(([from, to]) => result.snippet.text.slice(from, to)), matches);
    assert.equal(result.snippet.text.isWellFormed(), true);
  }
  for (const query of ['a.b_100%', "' OR 1=1 --", '不存在的片段']) {
    assert.equal((await f.service.query({ query, scope: 'body', projectId: null, includeArchived: false })).results.length, 0);
  }
});

test('容量查询：有命中与无命中均让出事件循环，不截断历史或重新读取引擎', async () => {
  const f = await fixture();
  f.history.turns[0].items = Array.from({ length: 4096 }, (_, index) => ({ kind: 'message',
    threadId: f.task.threadId, turnId: f.task.turnId, itemId: `capacity-${index}`,
    text: `中文容量 A+B_100% ${'abcdef '.repeat(100)} ${index}`, status: 'completed', phase: 'final_answer' }));
  await f.service.rebuild();
  for (const [query, expectedItem] of [['a+b_100%', 'capacity-0'], ['4095', 'capacity-4095'], ['不存在的容量标记', null]]) {
    let pulses = 0, handle;
    const pulse = () => { pulses++; handle = setImmediate(pulse); };
    handle = setImmediate(pulse);
    try {
      const result = await f.service.query({ query, scope: 'body', projectId: null, includeArchived: false });
      assert.ok(pulses >= 2, '长查询过程中应持续处理其他事件，而不是一次同步扫描后才响应');
      assert.equal(result.results.length, expectedItem ? 1 : 0);
      if (expectedItem) assert.equal(result.results[0].source.itemId, expectedItem);
      assert.equal(result.coverage.coveredTasks, 1);
    } finally { clearImmediate(handle); }
  }
  assert.equal(f.calls.length, 1); assert.deepEqual(f.readWorkspace(f.root), f.before);
});

test('查询期间更新：索引可继续写入，但不得把两版内容拼成完整结果；重查可定位新来源', async () => {
  const f = await fixture();
  f.history.turns[0].items = Array.from({ length: 2048 }, (_, index) => ({ kind: 'message',
    threadId: f.task.threadId, turnId: f.task.turnId, itemId: `changing-${index}`,
    text: '原始中文标记', status: 'completed', phase: 'final_answer' }));
  await f.service.rebuild();
  const request = { query: '中文标记', scope: 'body', projectId: null, includeArchived: false };
  const old = await f.service.query(request);
  const reading = f.service.query(request);
  const rejected = assert.rejects(reading, /索引.*更新|期间.*变化/, '查询期间提交新索引应明确要求重查，不能假称是单一完整快照');
  await new Promise(resolve => setImmediate(resolve));
  for (const item of f.history.turns[0].items) item.text = '更新后的中文标记';
  await f.service.rebuild();
  await rejected;
  const fresh = await f.service.query(request);
  assert.equal(fresh.coverage.coveredTasks, 1);
  assert.notEqual(fresh.results[0].source.sourceRevision, old.results[0].source.sourceRevision);
  const located = await f.service.locate({ taskId: f.task.taskId, ...fresh.results[0].source });
  assert.equal(located.history.turns[0].items[0].text, '更新后的中文标记');
  assert.deepEqual(f.readWorkspace(f.root), f.before);
});

test('筛选与排序：项目和归档范围不串记录，标题优先，其次按字面命中数和活动排序且每会话唯一', async () => {
  const f = await fixture();
  const { associateProject } = require('../../src/main/storage/projects.ts');
  const { createTaskRecord, setTaskArchived } = require('../../src/main/storage/tasks.ts');
  const directory = path.join(f.root, 'second-project'); await fs.mkdir(directory);
  const project = associateProject(f.root, directory).project;
  const titleTask = { ...f.task, taskId: randomUUID(), projectId: project.projectId, directory, title: '季度报告',
    threadId: 'title-thread', turnId: 'title-turn', lastActivityAt: '2025-01-01T00:00:00.000Z' };
  const bodyTask = { ...f.task, taskId: randomUUID(), title: '多处内容命中', threadId: 'body-thread', turnId: 'body-turn', lastActivityAt: '2025-02-01T00:00:00.000Z' };
  createTaskRecord(f.root, titleTask); createTaskRecord(f.root, bodyTask);
  setTaskArchived(f.root, { taskId: bodyTask.taskId, operationId: randomUUID(), expectedRevision: 0, archived: true });
  const service = new f.TaskSearchService(f.root, async ({ taskId }) => {
    const task = [f.task, titleTask, bodyTask].find(task => task.taskId === taskId);
    const texts = taskId === f.task.taskId ? ['季度收入', '季度支出'] : taskId === bodyTask.taskId ? ['季度季度季度', ''] : ['季度说明', ''];
    return { taskId, threadId: task.threadId, turns: [{ ...f.history.turns[0], turnId: task.turnId,
      items: f.history.turns[0].items.map((item, index) => ({ ...item, threadId: task.threadId, turnId: task.turnId, text: texts[index] })) }] };
  });
  await service.rebuild();
  const request = { query: '季度', scope: 'all', projectId: null, includeArchived: true };
  const before = f.readWorkspace(f.root);
  const result = await service.query(request);
  assert.deepEqual(result.results.map(hit => hit.taskId), [titleTask.taskId, bodyTask.taskId, f.task.taskId]);
  assert.equal(result.coverage.coveredTasks, 3);
  assert.deepEqual((await service.query({ ...request, includeArchived: false })).results.map(hit => hit.taskId), [titleTask.taskId, f.task.taskId]);
  const filtered = await service.query({ ...request, projectId: project.projectId });
  assert.deepEqual(filtered.results.map(hit => hit.taskId), [titleTask.taskId]); assert.equal(filtered.coverage.totalTasks, 1);
  assert.deepEqual((await service.query({ ...request, scope: 'title' })).results.map(hit => hit.taskId), [titleTask.taskId]);
  assert.deepEqual((await service.query({ ...request, scope: 'body' })).results.map(hit => hit.taskId), [bodyTask.taskId, f.task.taskId, titleTask.taskId]);
  assert.deepEqual((await service.query({ ...request, query: '' })).results.map(hit => hit.taskId), [f.task.taskId, bodyTask.taskId, titleTask.taskId]);
  assert.deepEqual(f.readWorkspace(f.root), before);
});
