const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PassThrough } = require('node:stream');
require('ts-node').register({ transpileOnly: true });

for (const extension of ['txt', 'csv', 'docx', 'pdf']) test(`材料执行 ${extension}：首发续轮补充使用同一公开文本输入，保留版本与变化阻断`, async t => {
  const boundary = require('../../src/main/runtime/codex/process.ts');
  const { CodexTransport } = require('../../src/main/runtime/codex/transport.ts');
  const { ExecutionService } = require('../../src/main/services/execution.ts');
  const { MaterialService } = require('../../src/main/services/materials.ts');
  const { saveDraft, readDraft } = require('../../src/main/storage/drafts.ts');
  const { readInputMaterials } = require('../../src/main/storage/materials.ts');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'agentx-material-execution-')));
  const filename = path.join(root, `交付.${extension}`);
  const writeMaterial = async text => {
    if (extension === 'docx') {
      const { Document, Paragraph, Packer } = require('docx');
      await fs.writeFile(filename, await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(text)] }] })));
    } else if (extension === 'pdf') {
      await fs.writeFile(filename, require('../helpers/pdf-fixture.cjs').pdfBytes([text.includes('120') ? 'Budget 120' : 'Changed budget']));
    } else await fs.writeFile(filename, text);
  };
  await writeMaterial('指定事实：预算 120 元');
  const [material] = await new MaterialService(root).register([filename]);
  const scope = { projectId: null, taskId: null }, text = '读取材料并生成新文件';
  const draft = saveDraft(root, { ...scope, text, materialIds: [material.materialId], expectedRevision: 0 });
  const taskId = randomUUID(), directory = path.join(root, 'workspaces', taskId);
  const calls = [], connections = [], turns = [];
  let captures = 0;
  t.mock.method(boundary, 'openExecutionCodex', async (_options, handlers) => {
    const input = new PassThrough(), output = new PassThrough();
    const emit = value => output.write(JSON.stringify(value) + '\n'); connections.push(emit);
    input.on('data', bytes => {
      const request = JSON.parse(bytes.toString()); calls.push(request);
      const reply = result => emit({ id: request.id, result });
      if (request.method === 'thread/start' || request.method === 'thread/resume') reply({
        thread: { id: 'materials-thread', cwd: directory, status: { type: 'idle' } }, cwd: directory,
        model: 'deepseek-v4-flash', modelProvider: 'deepseek', approvalPolicy: 'on-request', approvalsReviewer: 'user',
        instructionSources: [], sandbox: { type: 'workspaceWrite', writableRoots: [directory], networkAccess: false },
      });
      else if (request.method === 'turn/start') { const turn = { id: `turn-${turns.length + 1}`, status: 'inProgress', items: [], itemsView: 'full' }; turns.push(turn); reply({ turn }); }
      else if (request.method === 'thread/read') reply({ thread: { id: 'materials-thread', cwd: directory, turns } });
      else if (request.method === 'turn/steer') reply({ turnId: turns.at(-1).id });
      else if (request.method === 'thread/backgroundTerminals/list') reply({ data: [], nextCursor: null });
      else assert.fail(`意外请求 ${request.method}`);
    });
    const transport = new CodexTransport(input, output, handlers);
    return { transport, identity: { pid: 1234, parentPid: process.pid, createdAt: new Date().toISOString(), executablePath: path.join(root, 'synthetic-codex.exe') },
      close: async () => { transport.close(); input.destroy(); output.destroy(); } };
  });
  const service = new ExecutionService(root, root, { captureExecution: async () => { captures++; return { modelId: 'deepseek-v4-flash',
    configRevision: 1, credentialRef: randomUUID(), apiKey: 'synthetic-material-key' }; } });
  t.after(() => service.close());
  const request = { taskId, projectId: null, operationId: randomUUID(), text, modelId: 'deepseek-v4-flash', configRevision: 1,
    materials: { revision: draft.revision, ids: [material.materialId] } };
  const first = await service.start(request);
  const sent = calls.find(call => call.method === 'turn/start').params.input;
  assert.equal(sent.length, 1); assert.equal(sent[0].type, 'text');
  assert.ok(sent[0].text.includes(JSON.stringify(filename))); assert.ok(sent[0].text.includes(material.version.sha256));
  assert.ok(!sent[0].text.includes('指定事实：预算 120 元'), '不假装上传正文，交给引擎本地读取');
  assert.match(sent[0].text, /保留原件/);
  if (extension === 'csv') {
    assert.match(sent[0].text, /office-cli/); assert.match(sent[0].text, /ELECTRON_RUN_AS_NODE/);
    assert.match(sent[0].text, /公式未重算/); assert.match(sent[0].text, /Out-String/);
  }
  if (extension === 'pdf') {
    assert.match(sent[0].text, /office-cli/); assert.match(sent[0].text, /pages/);
    assert.match(sent[0].text, /不生成 PDF/);
  }
  if (extension === 'docx') {
    assert.match(sent[0].text, /office-cli/); assert.match(sent[0].text, /paragraphs/);
    assert.match(sent[0].text, /新文件\.docx/); assert.match(sent[0].text, /重新读取/);
  }
  saveDraft(root, { projectId: null, taskId, text: '补充核对材料', materialIds: [material.materialId], expectedRevision: 0 });
  await service.steer({ taskId, threadId: first.threadId, turnId: first.turnId, operationId: randomUUID(), text: '补充核对材料',
    materials: { revision: 1, ids: [material.materialId] } });
  assert.ok(calls.find(call => call.method === 'turn/steer').params.input[0].text.includes(material.version.sha256));
  const complete = () => { turns.at(-1).status = 'completed'; connections.at(-1)({ method: 'turn/completed', params: { threadId: first.threadId, turn: turns.at(-1) } }); };
  complete();
  const savedInputs = readInputMaterials(root, taskId);
  assert.equal(savedInputs.length, 2); assert.equal(savedInputs[0].turnId, first.turnId);
  assert.equal(savedInputs[1].kind, 'steer'); assert.equal(savedInputs[1].acknowledged, true);
  assert.deepEqual(savedInputs[0].materials, [material]);
  const nextDraft = saveDraft(root, { projectId: null, taskId, text: '继续核对', materialIds: [material.materialId], expectedRevision: 1 });
  await writeMaterial('外部修改');
  const next = { ...request, text: '继续核对', operationId: randomUUID(), threadId: first.threadId, expectedTurnId: first.turnId,
    materials: { revision: nextDraft.revision, ids: [material.materialId] } };
  await assert.rejects(service.continue(next), /变化/);
  assert.equal(captures, 1); assert.equal(calls.filter(call => call.method === 'turn/start').length, 1);
  const refreshed = await new MaterialService(root).refresh(material.materialId);
  saveDraft(root, { projectId: null, taskId, text: next.text, materialIds: [refreshed.materialId], expectedRevision: 2 });
  const continued = await service.continue({ ...next, operationId: randomUUID(), materials: { revision: 3, ids: [refreshed.materialId] } }); complete();
  assert.equal(continued.threadId, first.threadId); assert.notEqual(continued.turnId, first.turnId);
  const inputs = readInputMaterials(root, taskId);
  assert.equal(inputs.length, 3); assert.deepEqual(inputs[0].materials, [material]);
  assert.deepEqual(inputs[2].materials, [refreshed]);
  assert.equal(readDraft(root, { projectId: null, taskId }).text, next.text);
  await service.shutdown();
});
