const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PassThrough } = require('node:stream');
require('ts-node').register({ transpileOnly: true });

test('独立任务存储拒绝任意工作目录，失败不留下无法读取的任务', async () => {
  const { createTaskRecord } = require('../../src/main/storage/tasks.ts');
  const { readWorkspace } = require('../../src/main/storage/projects.ts');
  const base = path.resolve('.local-validation/m2-02'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'invalid-directory-')), now = new Date().toISOString();
  assert.throws(() => createTaskRecord(root, { taskId: randomUUID(), projectId: null, title: '错误目录', directory: root,
    lastActivityAt: now, observedAt: now, executionState: 'submitting', threadId: null, turnId: null }));
  assert.deepEqual(readWorkspace(root), { projects: [], tasks: [] });
});

test('independentDraft：未关联草稿不创建目录；首发、租约、历史与同线程续轮保持同一独立任务', async t => {
  const boundary = require('../../src/main/runtime/codex/process.ts');
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const { ExecutionService } = require('../../src/main/services/execution.ts');
  const { readWorkspace } = require('../../src/main/storage/projects.ts');
  const { saveDraft, readDraft } = require('../../src/main/storage/drafts.ts');
  const { readRuntimeLeases } = require('../../src/main/storage/runtime-leases.ts');
  const base = path.resolve('.local-validation/m2-02'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'independent-'));
  saveDraft(root, { projectId: null, taskId: null, text: '整理文本材料', expectedRevision: 0 });
  assert.deepEqual(readWorkspace(root), { projects: [], tasks: [] });
  await assert.rejects(fs.stat(path.join(root, 'workspaces')), { code: 'ENOENT' });
  const taskId = randomUUID(), directory = path.join(root, 'workspaces', taskId);
  const calls = [], connections = [], turns = [];
  t.mock.method(boundary, 'openExecutionCodex', async (options, handlers) => {
    assert.equal(options.workingDirectory, directory);
    assert.equal((await fs.stat(directory)).isDirectory(), true);
    const input = new PassThrough(), output = new PassThrough();
    const emit = message => output.write(JSON.stringify(message) + '\n'); connections.push(emit);
    input.on('data', bytes => {
      const request = JSON.parse(bytes.toString()); calls.push(request);
      const reply = result => emit({ id: request.id, result });
      if (request.method === 'thread/start' || request.method === 'thread/resume') reply({
        thread: { id: 'independent-thread', cwd: directory, status: { type: 'idle' } }, cwd: directory,
        model: 'deepseek-v4-flash', modelProvider: 'deepseek', approvalPolicy: 'on-request', approvalsReviewer: 'user',
        instructionSources: [], sandbox: { type: 'workspaceWrite', writableRoots: [directory], networkAccess: false },
      });
      else if (request.method === 'turn/start') {
        const turn = { id: `turn-${turns.length + 1}`, status: 'inProgress', items: [], itemsView: 'full' };
        turns.push(turn); reply({ turn });
      } else if (request.method === 'thread/read') reply({ thread: { id: 'independent-thread', cwd: directory, turns } });
      else if (request.method === 'thread/backgroundTerminals/list') reply({ data: [], nextCursor: null });
      else assert.fail(`意外调用 ${request.method}`);
    });
    const transport = new CodexTransport(input, output, handlers);
    return { transport, identity: { pid: 1234, parentPid: process.pid, createdAt: new Date().toISOString(), executablePath: path.join(root, 'synthetic-codex.exe') },
      close: async () => { transport.close(); input.destroy(); output.destroy(); } };
  });
  const service = new ExecutionService(root, root, { captureExecution: async () => ({ modelId: 'deepseek-v4-flash',
    configRevision: 1, credentialRef: randomUUID(), apiKey: 'synthetic-independent-key' }) });
  t.after(() => service.close());
  const request = { taskId, projectId: null, operationId: randomUUID(), text: '整理文本材料', modelId: 'deepseek-v4-flash', configRevision: 1 };
  const first = await service.start(request);
  assert.equal(first.directory, directory); assert.equal(first.projectId, null);
  assert.equal(readRuntimeLeases(root)[0].projectId, null);
  await assert.rejects(service.start(request), /活动|使用/);
  const complete = () => { turns.at(-1).status = 'completed'; connections.at(-1)({ method: 'turn/completed', params: { threadId: first.threadId, turn: turns.at(-1) } }); };
  complete();
  saveDraft(root, { projectId: null, taskId, text: '保留这份续改草稿', expectedRevision: 0 });
  assert.equal(readDraft(root, { projectId: null, taskId }).text, '保留这份续改草稿');
  assert.equal((await service.readHistory({ taskId })).turns[0].turnId, first.turnId);
  const next = await service.continue({ ...request, operationId: randomUUID(), text: '继续调整', threadId: first.threadId, expectedTurnId: first.turnId });
  assert.equal(next.threadId, first.threadId); assert.notEqual(next.turnId, first.turnId); complete();
  assert.equal(readWorkspace(root).tasks.length, 1); assert.deepEqual(readWorkspace(root).projects, []);
  assert.deepEqual(await fs.readdir(path.join(root, 'workspaces')), [taskId]);
  assert.equal(calls.filter(call => call.method === 'thread/start').length, 1);
  assert.equal(calls.filter(call => call.method === 'turn/start').length, 2);
  await service.shutdown();
  assert.ok(readRuntimeLeases(root).every(lease => lease.projectId === null && lease.releasedAt));
  const { TaskSearchService } = require('../../src/main/services/task-search.ts');
  const { setTaskPinned, setTaskArchived } = require('../../src/main/storage/tasks.ts');
  const search = new TaskSearchService(root, async () => { throw new Error('标题查询不应执行模型或读取正文'); });
  const query = { query: '整理文本材料', scope: 'title', projectId: null, includeArchived: false };
  assert.equal((await search.query(query)).results[0].projectId, null);
  const pinned = setTaskPinned(root, { taskId, operationId: randomUUID(), expectedRevision: 0, pinned: true });
  assert.ok(pinned.pinnedAt); assert.equal(pinned.projectId, null);
  const archived = setTaskArchived(root, { taskId, operationId: randomUUID(), expectedRevision: pinned.organizationRevision, archived: true });
  assert.ok(archived.archivedAt); assert.equal((await search.query(query)).results.length, 0);
  assert.equal((await search.query({ ...query, includeArchived: true })).results[0].taskId, taskId);
  const restored = setTaskArchived(root, { taskId, operationId: randomUUID(), expectedRevision: archived.organizationRevision, archived: false });
  assert.equal(restored.archivedAt, null); assert.equal(restored.threadId, first.threadId);
  assert.equal((await search.query(query)).results.length, 1);
});
