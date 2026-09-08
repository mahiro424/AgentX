const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { launch } = require('./helpers.cjs');

test('执行产品桥：读取真实空快照，拒绝其他模型和无关联项目，不创建假任务', { timeout: 45000 }, async t => {
  const { app, page } = await launch(); t.after(() => app.close());
  const snapshot = await page.evaluate(() => window.agentx.getExecution());
  assert.deepEqual(snapshot, { preparing: false, task: null, operationId: null, items: [], approvals: [], error: null });
  const control = { taskId: randomUUID(), operationId: randomUUID(), threadId: 'unknown-thread', turnId: 'unknown-turn' };
  await assert.rejects(page.evaluate(value => window.agentx.steerExecution(value), { ...control, text: '不能改投新轮' }), /当前|有效/);
  await assert.rejects(page.evaluate(value => window.agentx.answerExecutionApproval(value), { ...control, approvalToken: randomUUID(), decision: 'accept' }), /当前|有效/);
  const request = { taskId: randomUUID(), operationId: randomUUID(), projectId: randomUUID(),
    text: '合成测试，不调用模型', modelId: 'other-model', configRevision: 0 };
  await assert.rejects(page.evaluate(value => window.agentx.startExecution(value), request), /Flash/);
  await assert.rejects(page.evaluate(value => window.agentx.startExecution(value), { ...request, modelId: 'deepseek-v4-flash' }), /项目未关联/);
  assert.deepEqual((await page.evaluate(() => window.agentx.getWorkspace())).tasks, []);
  const project = await app.evaluate(({ app }, repository) => {
    const req = process.getBuiltinModule('node:module').createRequire(repository + '/package.json');
    req('ts-node').register({ transpileOnly: true, project: repository + '/tsconfig.json' });
    return req(repository + '/src/main/storage/projects.ts').associateProject(app.getPath('userData'), app.getPath('userData')).project;
  }, path.resolve('.'));
  await page.evaluate(() => {
    window.executionChanges = 0;
    window.unsubscribeExecution = window.agentx.onExecutionChanged(() => { window.executionChanges++; });
  });
  try {
    await assert.rejects(page.evaluate(value => window.agentx.startExecution(value), { ...request, projectId: project.projectId, modelId: 'deepseek-v4-flash' }), /API Key/);
    await page.waitForFunction(() => window.executionChanges >= 2);
    assert.equal((await page.evaluate(() => window.agentx.getExecution())).preparing, false);
    assert.deepEqual((await page.evaluate(() => window.agentx.getWorkspace())).tasks, []);
  } finally { await page.evaluate(() => window.unsubscribeExecution()); }
});
