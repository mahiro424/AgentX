const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { launch } = require('./helpers.cjs');
const { pdfBytes } = require('../helpers/pdf-fixture.cjs');

test('随包 PDF 工具：无 PATH Node 或 native canvas，实际读取中文 CMap 与哈希', { timeout: 30000 }, async () => {
  const { execFile } = require('node:child_process'), { promisify } = require('node:util'), { createHash } = require('node:crypto');
  const directory = path.resolve(process.env.AGENTX_TEST_PACKAGE_DIR || 'out/AgentX-win32-x64');
  const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'agentx-packaged-pdf-')));
  const bytes = pdfBytes(['青禾项目预算九十五元', '星期五交付'], true), filename = path.join(cwd, '中文材料.pdf'); await fs.writeFile(filename, bytes);
  const sha = createHash('sha256').update(bytes).digest('hex');
  const result = await promisify(execFile)(path.join(directory, 'AgentX.exe'), ['--max-old-space-size=192',
    path.join(directory, 'resources/app.asar/.webpack/main/office-cli.js'), 'read', filename, sha, '已读取.json'], {
    cwd, windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024,
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|WINDIR|TEMP|TMP)$/i.test(key))), ELECTRON_RUN_AS_NODE: '1' },
  });
  const receipt = JSON.parse(result.stdout), value = JSON.parse(await fs.readFile(receipt.path, 'utf8'));
  assert.equal(receipt.sourceSha256, sha); assert.equal(value.pages[0].text, '青禾项目预算九十五元');
  assert.equal(value.pages[1].text, '星期五交付'); assert.deepEqual(await fs.readFile(filename), bytes);
});

test('pdfImage：真实 Electron 离线 PDF 页码、画布、缩放及版本变化提示，不提供脚本或表单操作', { timeout: 45000 }, async t => {
  const data = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'agentx-pdf-desktop-')));
  const filename = path.join(data, '交付材料.pdf'); await fs.writeFile(filename, pdfBytes());
  const { app, page } = await launch(data); t.after(() => app.close());
  await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, filename);
  await page.getByRole('button', { name: '添加材料', exact: true }).click();
  await page.getByRole('menuitem', { name: '添加文件', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '草稿已保存' }).waitFor();
  await page.getByRole('button', { name: '预览材料：交付材料.pdf' }).click();
  const preview = page.getByRole('region', { name: '只读文件预览' });
  const canvas = preview.locator('.pdf-page canvas');
  await canvas.waitFor({ timeout: 12000 });
  assert.equal(await canvas.getAttribute('aria-label'), 'PDF 第 1 页');
  assert.ok(await canvas.evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] && pixels[i] < 160) dark++;
    return dark > 20;
  }));
  await preview.getByRole('button', { name: '下一页 PDF', exact: true }).click();
  await preview.locator('.pdf-page canvas[aria-label="PDF 第 2 页"]').waitFor();
  assert.equal(await preview.getByRole('button', { name: '下一页 PDF', exact: true }).isEnabled(), false);
  const width = await canvas.evaluate(canvas => canvas.width);
  await preview.getByRole('button', { name: '放大文字', exact: true }).click();
  await page.waitForFunction(width => document.querySelector('.pdf-page canvas')?.width > width, width);
  assert.equal(await preview.locator('iframe,webview,[contenteditable=true]').count(), 0);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
  await page.waitForFunction(() => innerWidth === 960 && innerHeight === 640);
  assert.equal(await preview.locator('.pdf-thumbnails').evaluate(element => element.scrollWidth <= element.clientWidth), true);
  await fs.writeFile(filename, pdfBytes(['New external version']));
  await preview.getByRole('alert').filter({ hasText: /变化/ }).waitFor({ timeout: 10000 });
  assert.ok(await preview.getByRole('note').filter({ hasText: '保留上次成功读取的 PDF' }).isVisible());
  assert.equal(await preview.getByRole('button', { name: '本机打开', exact: true }).isEnabled(), false);
  assert.equal(await canvas.getAttribute('aria-label'), 'PDF 第 2 页');
});
