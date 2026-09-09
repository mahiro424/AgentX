const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Document, Paragraph, Packer } = require('docx');
const { launch } = require('./helpers.cjs');

test('随包文档工具：仅靠 Electron 实际读取和生成 DOCX，回读一致且不覆盖', { timeout: 35000 }, async () => {
  const { execFile } = require('node:child_process'), { promisify } = require('node:util');
  const directory = path.resolve(process.env.AGENTX_TEST_PACKAGE_DIR || 'out/AgentX-win32-x64');
  const cli = path.join(directory, 'resources/app.asar/.webpack/main/office-cli.js');
  const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'agentx-packaged-document-')));
  const paragraphs = ['原件事实：周五交付', '预算：95 元'];
  const bytes = await Packer.toBuffer(new Document({ sections: [{ children: paragraphs.map(text => new Paragraph(text)) }] }));
  const source = path.join(cwd, '原 件.docx'); await fs.writeFile(source, bytes);
  const run = args => promisify(execFile)(path.join(directory, 'AgentX.exe'), ['--max-old-space-size=192', cli, ...args], {
    cwd, windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024,
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|WINDIR|TEMP|TMP)$/i.test(key))), ELECTRON_RUN_AS_NODE: '1' },
  });
  const read = JSON.parse((await run(['read', source, createHash('sha256').update(bytes).digest('hex'), '读取.json'])).stdout);
  const data = JSON.parse(await fs.readFile(read.path, 'utf8')); assert.deepEqual(data.paragraphs, paragraphs);
  await fs.writeFile(path.join(cwd, '生成.json'), JSON.stringify({ paragraphs: [...data.paragraphs, '续改：增加交付检查'] }));
  const result = JSON.parse((await run(['write', '生成.json', '新文档.docx'])).stdout);
  const verified = JSON.parse((await run(['read', result.path, result.sha256, '核验.json'])).stdout);
  assert.deepEqual(JSON.parse(await fs.readFile(verified.path, 'utf8')).paragraphs, [...paragraphs, '续改：增加交付检查']);
  await assert.rejects(run(['write', '生成.json', '新文档.docx']), error => error.code === 1 && /EEXIST/.test(error.stderr));
  assert.deepEqual(await fs.readFile(source), bytes);
});

test('文档只读面板：真实 DOCX 段落、安全文字、缩放与陈旧版本提示，不提供假 Word 分页', { timeout: 45000 }, async t => {
  const data = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'agentx-document-desktop-')));
  const filename = path.join(data, '季度报告.docx'), paragraphs = ['青禾经营报告', '<script>globalThis.DOCX_EXECUTED=true</script>',
    ...Array.from({ length: 50 }, (_, i) => `第 ${i + 1} 项事实：本季收入 95，周五交付。`)];
  const bytes = await Packer.toBuffer(new Document({ sections: [{ children: paragraphs.map(text => new Paragraph(text)) }] }));
  await fs.writeFile(filename, bytes);
  const { app, page } = await launch(data); t.after(() => app.close());
  await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, filename);
  await page.getByRole('button', { name: '添加材料', exact: true }).click();
  await page.getByRole('menuitem', { name: '添加文件', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '草稿已保存' }).waitFor();
  await page.getByRole('textbox', { name: '任务要求' }).fill('保留原件并继续修改');
  await page.getByRole('button', { name: '预览材料：季度报告.docx' }).click();
  const preview = page.getByRole('region', { name: '只读文件预览' });
  const article = preview.getByRole('article', { name: 'DOCX 文本内容' });
  await article.getByText('青禾经营报告', { exact: true }).waitFor();
  assert.equal(await article.locator('p').count(), 52);
  assert.match(await article.innerText(), /<script>globalThis.DOCX_EXECUTED/);
  assert.equal(await page.evaluate(() => globalThis.DOCX_EXECUTED), undefined);
  assert.equal(await preview.locator('iframe,webview,[contenteditable=true]').count(), 0);
  assert.ok(await preview.getByText(/不保留.*Word 分页/).isVisible());
  const originalSize = await article.evaluate(element => getComputedStyle(element).fontSize);
  await preview.getByRole('button', { name: '放大文字', exact: true }).click();
  assert.equal(await preview.getByRole('button', { name: '还原文字缩放' }).textContent(), '110%');
  assert.notEqual(await article.evaluate(element => getComputedStyle(element).fontSize), originalSize);
  await fs.writeFile(filename, await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('外部新版本')] }] })));
  await preview.getByRole('alert').filter({ hasText: /变化/ }).waitFor({ timeout: 10000 });
  assert.ok(await preview.getByRole('note').filter({ hasText: '保留上次成功读取的文档' }).isVisible());
  assert.ok(await article.getByText('青禾经营报告', { exact: true }).isVisible());
  assert.equal(await preview.getByRole('button', { name: '本机打开', exact: true }).isEnabled(), false);
  await preview.getByRole('button', { name: '关闭文件预览' }).press('Escape');
  assert.equal(await page.getByRole('button', { name: '预览材料：季度报告.docx' }).evaluate(element => document.activeElement === element), true);
  assert.equal(await page.getByRole('textbox', { name: '任务要求' }).inputValue(), '保留原件并继续修改');
  assert.notEqual(createHash('sha256').update(await fs.readFile(filename)).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
});
