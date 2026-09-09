const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const JSZip = require('jszip');
require('ts-node').register({ transpileOnly: true });

async function documentBytes(body) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

test('readingDocument：DOCX 实际段落由子进程提取，保留中文及原件哈希', async () => {
  const { inspectMaterialFile } = require('../../src/main/services/materials.ts');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentx-document-'));
  const filename = path.join(root, '交付说明.docx');
  const bytes = await documentBytes('<w:p><w:r><w:t>青禾计划</w:t></w:r></w:p><w:p><w:r><w:t>交付日期：周五；金额：95</w:t></w:r></w:p>');
  await fs.writeFile(filename, bytes);
  const result = await inspectMaterialFile(filename);
  assert.equal(result.record.status, 'ready', result.record.message);
  assert.equal(result.record.kind, 'document');
  assert.equal(result.document.format, 'docx');
  assert.deepEqual(result.document.paragraphs, ['青禾计划', '交付日期：周五；金额：95']);
  assert.notEqual(result.document.parserPid, process.pid);
  assert.throws(() => process.kill(result.document.parserPid, 0), error => error.code === 'ESRCH');
  assert.equal(result.record.version.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(await fs.readFile(filename), bytes);
});

test('document：授权 DOCX 材料可持久化和只读预览，外部变化阻断原版本发送', async () => {
  const { MaterialService } = require('../../src/main/services/materials.ts');
  const { readFilePreview, openFilePreview } = require('../../src/main/services/file-preview.ts');
  const { saveDraft, readDraft } = require('../../src/main/storage/drafts.ts');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'agentx-document-preview-')));
  const filename = path.join(root, '事实.docx');
  await fs.writeFile(filename, await documentBytes('<w:p><w:r><w:t>实际文档事实</w:t></w:r></w:p>'));
  const service = new MaterialService(root), [material] = await service.register([filename]);
  const scope = { projectId: null, taskId: null }, source = { kind: 'material', scope, materialId: material.materialId };
  await assert.rejects(readFilePreview(root, source), /关联/);
  saveDraft(root, { ...scope, text: '阅读事实', expectedRevision: 0, materialIds: [material.materialId] });
  assert.equal(readDraft(root, scope).materials[0].kind, 'document');
  const preview = await readFilePreview(root, source);
  assert.equal(preview.status, 'ready'); assert.deepEqual(preview.document.paragraphs, ['实际文档事实']);
  assert.equal(preview.text, null); assert.equal(preview.version.sha256, material.version.sha256);
  const opened = [], host = { openPath: async value => { opened.push(value); return ''; }, showItemInFolder: () => {} };
  await openFilePreview(root, { source, action: 'open' }, host); assert.deepEqual(opened, [filename]);
  assert.equal((await new MaterialService(root).requireReady([material.materialId]))[0].materialId, material.materialId);
  await fs.writeFile(filename, await documentBytes('<w:p><w:r><w:t>外部新版本</w:t></w:r></w:p>'));
  const changed = await readFilePreview(root, source);
  assert.equal(changed.status, 'changed'); assert.equal(changed.document, null);
  assert.equal(changed.version.sha256, material.version.sha256);
  await assert.rejects(service.requireReady([material.materialId]), /变化/);
  await assert.rejects(openFilePreview(root, { source, action: 'open' }, host), /变化/);
  assert.equal(opened.length, 1);
});

test('unsupportedDocument：无可提取文字的 DOCX 明确阻断，同版本核验不把原失败改成就绪', async () => {
  const { MaterialService } = require('../../src/main/services/materials.ts');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'agentx-empty-document-')));
  const filename = path.join(root, '无文字.docx'); await fs.writeFile(filename, await documentBytes('<w:p/>'));
  const service = new MaterialService(root), [material] = await service.register([filename]);
  assert.equal(material.status, 'unreadable'); assert.match(material.message, /没有可提取文字/);
  const [checked] = await service.check([material.materialId]);
  assert.equal(checked.status, 'unreadable'); assert.equal(checked.message, material.message);
  await assert.rejects(service.requireReady([material.materialId]), /没有可提取文字/);
});

test('文档解析边界：损坏、加密、宏、解压超限不返回空文档；读取不展开外部超链接', async () => {
  const { readDocument } = require('../../src/main/services/spreadsheet.ts');
  await assert.rejects(readDocument(Buffer.from('不是文档'), '.docx'), /失败/);
  await assert.rejects(readDocument(Buffer.from('d0cf11e0a1b11ae1', 'hex'), '.docx'), /加密或旧版/);
  await assert.rejects(readDocument(Buffer.alloc(8 * 1024 * 1024 + 1), '.docx'), /大小/);
  const base = await documentBytes('<w:p><w:r><w:t>只读文字</w:t></w:r></w:p>');
  const macro = await JSZip.loadAsync(base); macro.file('word/vbaProject.bin', '宏');
  await assert.rejects(readDocument(await macro.generateAsync({ type: 'nodebuffer' }), '.docx'), /包含宏/);
  const bomb = await JSZip.loadAsync(base); bomb.file('word/huge.xml', Buffer.alloc(32 * 1024 * 1024 + 1, 65));
  await assert.rejects(readDocument(await bomb.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), '.docx'), /解压内容/);
  const linked = await JSZip.loadAsync(await documentBytes('<w:p><w:hyperlink xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="external"><w:r><w:t>保留链接文字</w:t></w:r></w:hyperlink></w:p>'));
  linked.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="external" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="file:///不存在的材料.txt" TargetMode="External"/></Relationships>');
  const value = await readDocument(await linked.generateAsync({ type: 'nodebuffer' }), '.docx');
  assert.deepEqual(value.paragraphs, ['保留链接文字']);
  assert.match(value.messages.join(' '), /不保留.*Word 分页/);
});
