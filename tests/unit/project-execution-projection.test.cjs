const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
require('ts-node').register({ transpileOnly: true });

test('项目会话状态：只有本实例执行拥有者提供实时投影，其他旧活动记录保持待核对', async () => {
  const { ProjectService } = require('../../src/main/services/projects.ts');
  const { associateProject } = require('../../src/main/storage/projects.ts');
  const { createTaskRecord } = require('../../src/main/storage/tasks.ts');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-04/project-projection-'));
  const project = associateProject(root, root).project, now = new Date().toISOString();
  const task = { taskId: randomUUID(), projectId: project.projectId, directory: root, title: '当前任务',
    executionState: 'running', threadId: 'owned-thread', turnId: 'owned-turn', lastActivityAt: now, observedAt: now };
  const old = { ...task, taskId: randomUUID(), title: '上次进程遗留任务', threadId: 'old-thread' };
  createTaskRecord(root, task); createTaskRecord(root, old);
  let owned = null;
  const service = new ProjectService(root, () => owned);
  assert.ok((await service.read()).tasks.every(value => value.executionState === 'reconciling'));
  for (const state of ['running', 'waitingApproval', 'stopping', 'interrupted']) {
    owned = { ...task, executionState: state };
    const snapshot = await service.read();
    assert.equal(snapshot.tasks.find(value => value.taskId === task.taskId).executionState, state);
    assert.equal(snapshot.tasks.find(value => value.taskId === old.taskId).executionState, 'reconciling');
  }
  owned = { ...task, projectId: randomUUID() };
  assert.equal((await service.read()).tasks.find(value => value.taskId === task.taskId).executionState, 'reconciling');
  owned = null;
  assert.ok((await service.read()).tasks.every(value => value.executionState === 'reconciling'));
});


test('活动会话改名：旧执行快照不能覆盖新标题，组织不更新活动时间或轮次', async () => {
  const { ProjectService } = require('../../src/main/services/projects.ts');
  const { associateProject } = require('../../src/main/storage/projects.ts');
  const { createTaskRecord } = require('../../src/main/storage/tasks.ts');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-04/rename-projection-'));
  const project = associateProject(root, root).project, now = new Date().toISOString();
  const current = { taskId: randomUUID(), projectId: project.projectId, directory: root, title: '引擎已持有的旧名称',
    executionState: 'running', threadId: 'owned-thread', turnId: 'owned-turn', lastActivityAt: now, observedAt: now };
  createTaskRecord(root, current);
  const service = new ProjectService(root, () => current);
  const saved = service.renameTask({ operationId: randomUUID(), taskId: current.taskId, title: '产品中的新名称', expectedRevision: 0 });
  assert.deepEqual((await service.read()).tasks, [saved]);
  assert.deepEqual({ ...saved, title: current.title, organizationRevision: undefined }, { ...current, organizationRevision: undefined });
});
