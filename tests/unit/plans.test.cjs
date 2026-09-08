const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: true });

test('计划事件：只采用固定协议真实步骤，不将未知状态转换为完成', () => {
  const { parsePlanEvent } = require('../../src/main/runtime/codex/events.ts');
  assert.equal(parsePlanEvent({ method: 'item/agentMessage/delta', params: {} }), null);
  const value = { threadId: 'thread-plan', turnId: 'turn-plan', explanation: null,
    plan: [{ step: '检查项目', status: 'completed' }, { step: '修改文件', status: 'inProgress' }, { step: '运行测试', status: 'pending' }] };
  assert.deepEqual(parsePlanEvent({ method: 'turn/plan/updated', params: value }), value);
  assert.throws(() => parsePlanEvent({ method: 'turn/plan/updated', params: { ...value, plan: [{ step: '测试', status: 'success' }] } }), /计划/);
  assert.throws(() => parsePlanEvent({ method: 'turn/plan/updated', params: { ...value, turnId: '' } }), /计划/);
});

test('计划归属：早到计划按轮次绑定，旧轮不混入，终态后不伪造步骤完成', async () => {
  const fs = require('node:fs/promises'), path = require('node:path'), { randomUUID } = require('node:crypto');
  const { FirstTurnSession } = require('../../src/main/services/execution.ts');
  const { associateProject } = require('../../src/main/storage/projects.ts');
  const root = await fs.mkdtemp(path.resolve('.local-validation/m1-04/plan-session-'));
  const project = associateProject(root, root).project, now = new Date().toISOString();
  const session = new FirstTurnSession(root, { taskId: randomUUID(), projectId: project.projectId, directory: root, title: '计划归属',
    lastActivityAt: now, observedAt: now, executionState: 'submitting', threadId: null, turnId: null },
  { operationId: randomUUID(), text: '合成目标', modelId: 'deepseek-v4-flash', configRevision: 1, credentialRef: randomUUID() });
  const plan = { threadId: 'thread-plan', turnId: 'turn-plan', explanation: '合成真实事件形状', plan: [{ step: '修复文件', status: 'inProgress' }] };
  assert.equal(session.readPlan(), undefined);
  await session.submit({ call: async method => {
    if (method === 'thread/start') return { thread: { id: plan.threadId, cwd: root }, cwd: root, model: 'deepseek-v4-flash', modelProvider: 'deepseek',
      approvalPolicy: 'on-request', approvalsReviewer: 'user', instructionSources: [], sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: false } };
    assert.equal(method, 'turn/start');
    session.notification({ method: 'turn/plan/updated', params: plan });
    return { turn: { id: plan.turnId } };
  } });
  assert.deepEqual(session.readPlan(), plan);
  const copy = session.readPlan(); copy.plan[0].step = '篡改';
  session.notification({ method: 'turn/plan/updated', params: { ...plan, turnId: 'old-turn', plan: [] } });
  assert.deepEqual(session.readPlan(), plan);
  session.notification({ method: 'turn/completed', params: { threadId: plan.threadId, turn: { id: plan.turnId, status: 'interrupted' } } });
  session.notification({ method: 'turn/plan/updated', params: { ...plan, plan: [{ step: '迟到内容', status: 'completed' }] } });
  assert.deepEqual(session.readPlan(), plan);
});
