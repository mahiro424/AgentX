const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
require('ts-node').register({ transpileOnly: true });

test('材料：取消不登记；文本选择与拖入共用有界核验，相同文件去重且重开可读引用', async () => {
  const { MaterialService } = require('../../src/main/services/materials.ts');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentx-materials-'));
  const filename = path.join(root, '材料.txt');
  await fs.writeFile(filename, '青禾项目：周五交付\n');
  const service = new MaterialService(root);
  assert.deepEqual(await service.register([]), []);
  assert.deepEqual(await fs.readdir(root), ['材料.txt']);
  const selected = await service.register([filename, filename]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].name, '材料.txt');
  assert.equal(selected[0].status, 'ready');
  assert.equal(selected[0].kind, 'text');
  assert.match(selected[0].version.sha256, /^[a-f0-9]{64}$/);
  const reopened = new MaterialService(root);
  assert.deepEqual(await reopened.check([selected[0].materialId]), selected);
  assert.equal((await reopened.register([filename]))[0].materialId, selected[0].materialId);
  assert.equal(await fs.readFile(filename, 'utf8'), '青禾项目：周五交付\n');
});

test('图片粘贴格式：PNG 与 JPEG 都保留原始字节并阻断发送，不把 JPEG 误报成文本或丢弃', async () => {
  const { MaterialService } = require('../../src/main/services/materials.ts');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentx-paste-format-'));
  const bytes = Buffer.from([255, 216, 255, 224, 255, 217]);
  const image = await new MaterialService(root).pasteImage(bytes, 'image/jpeg');
  assert.equal(image.kind, 'image'); assert.equal(image.status, 'blockedImage');
  assert.ok(image.path.endsWith('.jpg'));
  assert.deepEqual(await fs.readFile(image.path), bytes);
});

test('材料发送：冻结草稿修订和真实文件版本，变化、缺失、图片或遗漏引用均阻断，不清除草稿', async () => {
  const { MaterialService } = require('../../src/main/services/materials.ts');
  const { readDraft, saveDraft } = require('../../src/main/storage/drafts.ts');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentx-material-freeze-'));
  const filename = path.join(root, '事实.txt'); await fs.writeFile(filename, '旧事实');
  const service = new MaterialService(root), [material] = await service.register([filename]);
  const scope = { projectId: null, taskId: null }, text = '整理事实';
  const draft = saveDraft(root, { ...scope, text, materialIds: [material.materialId], expectedRevision: 0 });
  const binding = { revision: draft.revision, ids: [material.materialId] };
  const frozen = await service.freeze(scope, text, binding);
  assert.deepEqual(frozen.records, [material]);
  await assert.rejects(service.freeze(scope, text, undefined), /材料/);
  await assert.rejects(service.freeze(scope, text, { ...binding, revision: 0 }), /修订/);
  await fs.writeFile(filename, '新事实');
  await assert.rejects(service.freeze(scope, text, binding), /变化/);
  assert.deepEqual(readDraft(root, scope), draft);
  const changed = (await service.check(binding.ids))[0]; assert.equal(changed.status, 'changed');
  const refreshed = await service.refresh(material.materialId); assert.notEqual(refreshed.materialId, material.materialId);
  assert.equal((await service.check(binding.ids))[0].version.sha256, material.version.sha256);
  await fs.unlink(filename);
  assert.equal((await service.check([refreshed.materialId]))[0].status, 'missing');
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const image = await service.pasteImage(png);
  assert.equal(image.status, 'blockedImage');
  saveDraft(root, { ...scope, text, expectedRevision: 1, materialIds: [image.materialId] });
  await assert.rejects(service.freeze(scope, text, { revision: 2, ids: [image.materialId] }), /图像/);
});

test('材料草稿：文本和材料同一次 CAS 保存，重开恢复，旧写或伪造引用不能覆盖，移除不删原件', async () => {
  const { MaterialService } = require('../../src/main/services/materials.ts');
  const { readDraft, saveDraft } = require('../../src/main/storage/drafts.ts');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentx-material-draft-'));
  const filename = path.join(root, '提纲.md');
  await fs.writeFile(filename, '# 提纲\n预算 120 元');
  const [material] = await new MaterialService(root).register([filename]);
  const scope = { projectId: null, taskId: null };
  const saved = saveDraft(root, { ...scope, text: '整理提纲', materialIds: [material.materialId], expectedRevision: 0 });
  assert.deepEqual(saved.materials, [material]);
  assert.deepEqual(readDraft(root, scope), saved);
  assert.throws(() => saveDraft(root, { ...scope, text: '旧写', materialIds: [], expectedRevision: 0 }), /草稿/);
  assert.throws(() => saveDraft(root, { ...scope, text: '假引用', materialIds: ['00000000-0000-0000-0000-000000000000'], expectedRevision: 1 }), /记录|关联/);
  assert.deepEqual(readDraft(root, scope), saved);
  const removed = saveDraft(root, { ...scope, text: '整理提纲', materialIds: [], expectedRevision: 1 });
  assert.deepEqual(removed.materials, []);
  assert.deepEqual(await new MaterialService(root).check([material.materialId]), [material]);
  assert.equal(await fs.readFile(filename, 'utf8'), '# 提纲\n预算 120 元');
});
