const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const cli = path.resolve('src/main/tools/office-cli.cjs');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (cwd, args) => promisify(execFile)(process.execPath, ['--max-old-space-size=192', cli, ...args], {
  cwd, windowsHide: true, timeout: 35000, maxBuffer: 1024 * 1024,
  env: Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|WINDIR|TEMP|TMP)$/i.test(key))),
});

test('文档命令：生成新的 DOCX 并按实际哈希回读段落，同名和错误哈希不改写文件', async () => {
  const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'agentx-document-cli-')));
  const paragraphs = ['青禾季度报告', '收入：95；交付：周五', '<script>只是文字</script>'];
  await fs.writeFile(path.join(cwd, '内容.json'), JSON.stringify({ paragraphs }));
  const result = JSON.parse((await run(cwd, ['write', '内容.json', '报告.docx'])).stdout);
  const bytes = await fs.readFile(result.path);
  assert.equal(result.sha256, digest(bytes)); assert.equal(result.validation, 'structure-only');
  assert.equal(result.paragraphCount, 3); assert.equal(result.formulaStatus, undefined);
  const JSZip = require('jszip'), zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /青禾季度报告/); assert.match(xml, /收入：95；交付：周五/); assert.match(xml, /&lt;script&gt;/);
  const read = JSON.parse((await run(cwd, ['read', result.path, result.sha256, '回读.json'])).stdout);
  assert.equal(read.sourceSha256, result.sha256);
  const document = JSON.parse(await fs.readFile(read.path, 'utf8'));
  assert.equal(document.format, 'docx'); assert.deepEqual(document.paragraphs, paragraphs);
  await assert.rejects(run(cwd, ['write', '内容.json', '报告.docx']), error => error.code === 1 && /EEXIST/.test(error.stderr));
  await assert.rejects(run(cwd, ['read', result.path, '0'.repeat(64), '错误.json']), /版本.*变化/);
  assert.equal(digest(await fs.readFile(result.path)), digest(bytes));
  await assert.rejects(fs.access(path.join(cwd, '错误.json')), /ENOENT/);
});

test('表格命令读取：核对材料哈希，生成含坐标类型与公式的结构化文件，不覆盖任何已有文件', async () => {
  const { Workbook } = require('exceljs');
  const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'agentx-office-cli-')));
  const book = new Workbook(), sheet = book.addWorksheet('明细');
  sheet.addRow(['编号', '数量']); sheet.addRow(['0012', 3]); sheet.getCell('C2').value = { formula: 'B2*2', result: 6 };
  const bytes = Buffer.from(await book.xlsx.writeBuffer()), source = path.join(cwd, '原 件.xlsx'); await fs.writeFile(source, bytes);
  const value = JSON.parse((await run(cwd, ['read', source, digest(bytes), '读取.json'])).stdout);
  assert.equal(value.path, path.join(cwd, '读取.json')); assert.equal(value.sourceSha256, digest(bytes));
  const data = JSON.parse(await fs.readFile(value.path, 'utf8'));
  assert.equal(data.sheets[0].rows[1][0].value, '0012');
  assert.deepEqual(data.sheets[0].rows[1][2], { type: 'formula', value: null, formula: 'B2*2', cached: 6 });
  assert.equal(data.formulaStatus, 'not-recalculated');
  await assert.rejects(run(cwd, ['read', source, digest(bytes), '读取.json']), /EEXIST|已存在/);
  await assert.rejects(run(cwd, ['read', source, '0'.repeat(64), '错误.json']), /版本.*变化/);
  assert.equal(await fs.access(path.join(cwd, '错误.json')).then(() => true, () => false), false);
  assert.equal(digest(await fs.readFile(source)), digest(bytes));
});

test('表格命令生成：新建 XLSX 多表与 CSV，重新读取数值和公式，不覆盖原件或同名人工文件', async () => {
  const { Workbook } = require('exceljs');
  const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'agentx-office-write-')));
  const spec = { sheets: [{ name: '明细', rows: [['编号', '金额'], ['0012', 30], ['0013', 45]] },
    { name: '汇总', rows: [['总额', { formula: "SUM('明细'!B2:B3)", result: 75 }], ['日期', { date: '2026-09-09T00:00:00.000Z' }]] }] };
  await fs.writeFile(path.join(cwd, '内容.json'), JSON.stringify(spec));
  const result = JSON.parse((await run(cwd, ['write', '内容.json', '统计.xlsx'])).stdout);
  assert.equal(result.validation, 'structure-only'); assert.equal(result.formulaStatus, 'not-recalculated');
  const bytes = await fs.readFile(result.path), book = new Workbook(); await book.xlsx.load(bytes);
  assert.equal(result.sha256, digest(bytes)); assert.equal(book.worksheets.length, 2);
  assert.equal(book.worksheets[0].getCell('A2').value, '0012'); assert.equal(book.worksheets[0].getCell('B3').value, 45);
  assert.deepEqual(book.worksheets[1].getCell('B1').value, { formula: "SUM('明细'!B2:B3)", result: 75 });
  await assert.rejects(run(cwd, ['write', '内容.json', '统计.xlsx']), /已存在|EEXIST/);
  assert.equal(digest(await fs.readFile(result.path)), digest(bytes));
  await fs.writeFile(path.join(cwd, '单表.json'), JSON.stringify({ sheets: [spec.sheets[0]] }));
  const csv = JSON.parse((await run(cwd, ['write', '单表.json', '明细.csv'])).stdout);
  assert.match(await fs.readFile(csv.path, 'utf8'), /0012,30/);
  await assert.rejects(run(cwd, ['write', '内容.json', '丢表.csv']), /CSV.*一个工作表/);
  assert.equal(await fs.access(path.join(cwd, '丢表.csv')).then(() => true, () => false), false);
});

test('CSV 生成：公式样式文本不生成可能被外部表格软件执行的文件，不静默更改原值', async () => {
  const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'agentx-office-csv-')));
  for (const value of ['=1+2', ' @SUM(1,2)', '\t+1', '-cmd', '\r=1']) {
    await fs.writeFile(path.join(cwd, '内容.json'), JSON.stringify({ sheets: [{ name: '数据', rows: [[value]] }] }));
    await assert.rejects(run(cwd, ['write', '内容.json', '不安全.csv']), /CSV.*公式样式.*XLSX/);
    assert.equal(await fs.access(path.join(cwd, '不安全.csv')).then(() => true, () => false), false);
  }
  await fs.writeFile(path.join(cwd, '内容.json'), JSON.stringify({ sheets: [{ name: '数据', rows: [['=1+2', -3]] }] }));
  const xlsx = JSON.parse((await run(cwd, ['write', '内容.json', '保留原值.xlsx'])).stdout);
  const { Workbook } = require('exceljs'), book = new Workbook(); await book.xlsx.load(await fs.readFile(xlsx.path));
  assert.equal(book.worksheets[0].getCell('A1').value, '=1+2');
  assert.equal(book.worksheets[0].getCell('A1').formula, undefined);
  assert.equal(book.worksheets[0].getCell('B1').value, -3);
});

test('Windows 文件锁：独占锁定材料时读取失败，退出后可重试且原件不变', { timeout: 20000 }, async t => {
  const { spawn } = require('node:child_process'), { once } = require('node:events');
  const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'agentx-sheet-lock-')));
  const filename = path.join(cwd, '锁定.csv'), bytes = Buffer.from('姓名,金额\n小林,75'); await fs.writeFile(filename, bytes);
  const script = `$f=[IO.File]::Open('${filename.replaceAll("'", "''")}',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None);[Console]::WriteLine('locked');[Console]::Out.Flush();Start-Sleep -Seconds 15;$f.Close()`;
  const child = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'close'); t.after(async () => { if (child.exitCode === null) child.kill(); await closed; });
  const [ready] = await once(child.stdout, 'data'); assert.match(ready.toString(), /locked/);
  await assert.rejects(run(cwd, ['read', filename, digest(bytes), '被锁定.json']), /EBUSY|EACCES|EPERM/);
  assert.equal(await fs.access(path.join(cwd, '被锁定.json')).then(() => true, () => false), false);
  child.kill(); await closed;
  await run(cwd, ['read', filename, digest(bytes), '重试.json']);
  assert.equal(digest(await fs.readFile(filename)), digest(bytes));
});
