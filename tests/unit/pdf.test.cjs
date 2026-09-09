const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pdfBytes } = require('../helpers/pdf-fixture.cjs');
require('ts-node').register({ transpileOnly: true });

test('readingDocument：文本 PDF 由子进程逐页读取，不需要 native canvas，原件保持完整', async () => {
  const { inspectMaterialFile } = require('../../src/main/services/materials.ts');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentx-pdf-'));
  const filename = path.join(root, '交付材料.pdf'), bytes = pdfBytes();
  await fs.writeFile(filename, bytes);
  const value = await inspectMaterialFile(filename);
  assert.equal(value.record.status, 'ready', value.record.message);
  assert.equal(value.record.kind, 'pdf'); assert.equal(value.pdf.format, 'pdf');
  assert.equal(value.pdf.pages.length, 2);
  assert.equal(value.pdf.pages[0].text, 'Project Cedar; amount 95');
  assert.equal(value.pdf.pages[1].text, 'Delivery Friday');
  assert.notEqual(value.pdf.parserPid, process.pid);
  assert.throws(() => process.kill(value.pdf.parserPid, 0), error => error.code === 'ESRCH');
  assert.equal(value.record.version.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(await fs.readFile(filename), bytes);
});

test('pdfImage：授权 PDF 材料返回同一已核验版本的页面文字与原始字节，外部变更不能打开旧引用', async () => {
  const { MaterialService } = require('../../src/main/services/materials.ts');
  const { saveDraft, readDraft } = require('../../src/main/storage/drafts.ts');
  const { readFilePreview, openFilePreview } = require('../../src/main/services/file-preview.ts');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'agentx-pdf-preview-')));
  const filename = path.join(root, '材料.pdf'), bytes = pdfBytes(); await fs.writeFile(filename, bytes);
  const service = new MaterialService(root), [material] = await service.register([filename]);
  const scope = { projectId: null, taskId: null }, source = { kind: 'material', scope, materialId: material.materialId };
  await assert.rejects(readFilePreview(root, source), /未关联/);
  const draft = readDraft(root, scope);
  saveDraft(root, { ...scope, expectedRevision: draft.revision, text: '', materialIds: [material.materialId] });
  const observed = await readFilePreview(root, source);
  assert.equal(observed.status, 'ready', observed.message); assert.equal(observed.pdf.pages.length, 2);
  assert.deepEqual(Buffer.from(observed.pdfData, 'base64'), bytes);
  assert.equal(readDraft(root, scope).materials[0].kind, 'pdf');
  const opened = [], host = { openPath: async filename => { opened.push(filename); return ''; }, showItemInFolder() {} };
  await openFilePreview(root, { source, action: 'open' }, host); assert.deepEqual(opened, [filename]);
  await fs.writeFile(filename, pdfBytes(['External version']));
  const changed = await readFilePreview(root, source); assert.equal(changed.status, 'changed');
  assert.equal(changed.pdf, null); assert.equal(changed.pdfData, null);
  await assert.rejects(service.requireReady([material.materialId]), /变化/);
  await assert.rejects(openFilePreview(root, { source, action: 'open' }, host), /变化/);
});

test('unsupportedDocument/partialDocument：损坏、超页数和无文字 PDF 不返回空成功；混合空白页明确标示', async () => {
  const { readPdf } = require('../../src/main/services/spreadsheet.ts');
  await assert.rejects(readPdf(Buffer.from('不是 PDF'), '.pdf'), /失败/);
  await assert.rejects(readPdf(pdfBytes(['']), '.pdf'), /没有可提取文字/);
  await assert.rejects(readPdf(pdfBytes(Array(201).fill('Page')), '.pdf'), /最多 200 页/);
  await assert.rejects(readPdf(Buffer.alloc(8 * 1024 * 1024 + 1), '.pdf'), /大小/);
  const mixed = await readPdf(pdfBytes(['Readable', '']), '.pdf');
  assert.equal(mixed.pages.length, 2); assert.equal(mixed.pages[1].text, '');
  assert.match(mixed.messages.join(' '), /第 2 页没有可提取文字/);
  assert.throws(() => require.resolve('@napi-rs/canvas'), error => error.code === 'MODULE_NOT_FOUND');
});

test('PDF 中文 CMap：从离线资源还原中文事实，不以 ASCII 样例冒充中文兼容', async () => {
  const { readPdf } = require('../../src/main/services/spreadsheet.ts');
  const value = await readPdf(pdfBytes(['青禾项目预算九十五元', '星期五交付'], true), '.pdf');
  assert.equal(value.pages[0].text, '青禾项目预算九十五元');
  assert.equal(value.pages[1].text, '星期五交付');
});

test('PDF 解析错误：用户看到文件损坏原因，不把非必需 canvas 的初始化诊断当成缺少依赖', async () => {
  const { readPdf } = require('../../src/main/services/spreadsheet.ts');
  await assert.rejects(readPdf(Buffer.from('损坏 PDF'), '.pdf'), error =>
    /PDF解析失败/.test(error.message) && /Invalid PDF|structure/i.test(error.message) && !/Cannot load|canvas|DOMMatrix/.test(error.message));
});
