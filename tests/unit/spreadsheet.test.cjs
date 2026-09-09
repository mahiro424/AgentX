const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: true });

test('readingOffice：独立进程读取 CSV，保留中文、引号、换行、前导零和公式样式原文', async () => {
  const { readSpreadsheet } = require('../../src/main/services/spreadsheet.ts');
  const bytes = Buffer.from('\uFEFF姓名,编号,备注\r\n小林,0012,"甲,乙\n第二行"\r\n青禾,0,=1+2\r\n');
  const value = await readSpreadsheet(bytes, '.csv');
  assert.equal(value.format, 'csv');
  assert.equal(value.sheets.length, 1);
  assert.equal(value.sheets[0].rowCount, 3);
  assert.equal(value.sheets[0].columnCount, 3);
  assert.equal(value.sheets[0].rows[1][1].value, '0012');
  assert.equal(value.sheets[0].rows[1][2].value, '甲,乙\n第二行');
  assert.equal(value.sheets[0].rows[2][2].value, '=1+2');
  assert.equal(value.sheets[0].rows[2][2].formula, null);
  assert.notEqual(value.parserPid, process.pid, '解析不得运行在调用进程内');
  assert.throws(() => process.kill(value.parserPid, 0), error => error.code === 'ESRCH');
});

test('unsupportedOffice：超出工作表边界不得截断成成功结果', async () => {
  const { readSpreadsheet } = require('../../src/main/services/spreadsheet.ts');
  await assert.rejects(readSpreadsheet(Buffer.from(Array(2001).fill('值').join('\n')), '.csv'), /2000 行/);
});

test('unsupportedOffice：无效 XLSX 数值不能经 JSON 变成空单元格', async () => {
  const { Workbook } = require('exceljs'), JSZip = require('jszip');
  const { readSpreadsheet } = require('../../src/main/services/spreadsheet.ts');
  const book = new Workbook(); book.addWorksheet('坏数值').getCell('A1').value = 120;
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
  const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  zip.file('xl/worksheets/sheet1.xml', xml.replace('<v>120</v>', '<v>NaN</v>'));
  await assert.rejects(readSpreadsheet(await zip.generateAsync({ type: 'nodebuffer' }), '.xlsx'), /无效数值/);
});

test('readingOffice：合并单元格只在主格保留数值，不重复成多个数值', async () => {
  const { Workbook } = require('exceljs');
  const { readSpreadsheet } = require('../../src/main/services/spreadsheet.ts');
  const book = new Workbook(), sheet = book.addWorksheet('合并');
  sheet.getCell('A1').value = 120; sheet.mergeCells('A1:B2');
  const value = await readSpreadsheet(Buffer.from(await book.xlsx.writeBuffer()), '.xlsx');
  assert.equal(value.sheets[0].rows[0][0].value, 120);
  const merged = value.sheets[0].rows[1][1];
  assert.equal(merged.type, 'merged'); assert.equal(merged.value, null); assert.equal(merged.mergedInto, 'A1');
});

test('readingOffice：并发读取有界，超出的预览明确忙碌而不是无限启动解析进程', async () => {
  const { readSpreadsheet } = require('../../src/main/services/spreadsheet.ts');
  const running = [readSpreadsheet(Buffer.from('A\n1'), '.csv'), readSpreadsheet(Buffer.from('B\n2'), '.csv')];
  try { await assert.rejects(readSpreadsheet(Buffer.from('C\n3'), '.csv'), /表格.*忙碌/); }
  finally { await Promise.all(running); }
  assert.equal((await readSpreadsheet(Buffer.from('D\n4'), '.csv')).sheets[0].rows[1][0].value, '4');
});

test('readingOffice：大于管道分块的中文读取不损坏字符，CSV 编码错误明确失败', async () => {
  const { readSpreadsheet } = require('../../src/main/services/spreadsheet.ts');
  const rows = Array.from({ length: 1000 }, (_, index) => `${index}-${'中文材料'.repeat(31)}`);
  const value = await readSpreadsheet(Buffer.from(rows.join('\n')), '.csv');
  assert.deepEqual(value.sheets[0].rows.map(row => row[0].value), rows);
  await assert.rejects(readSpreadsheet(Buffer.from([0xc0, 0xaf]), '.csv'), /UTF-8/);
});

test('unsupportedOffice：拒绝伪造、加密、宏以及解压超限的 XLSX，不把空 ZIP 当空工作簿', async () => {
  const JSZip = require('jszip');
  const { readSpreadsheet } = require('../../src/main/services/spreadsheet.ts');
  const empty = await new JSZip().generateAsync({ type: 'nodebuffer' });
  await assert.rejects(readSpreadsheet(empty, '.xlsx'), /有效 XLSX/);
  await assert.rejects(readSpreadsheet(Buffer.from('d0cf11e0a1b11ae1', 'hex'), '.xlsx'), /加密|旧版/);
  const zipped = new JSZip().file('xl/workbook.xml', '<workbook/>').file('xl/vbaProject.bin', 'macro');
  await assert.rejects(readSpreadsheet(await zipped.generateAsync({ type: 'nodebuffer' }), '.xlsx'), /宏/);
  zipped.remove('xl/vbaProject.bin'); zipped.file('xl/padding.xml', Buffer.alloc(33 * 1024 * 1024, 65));
  await assert.rejects(readSpreadsheet(await zipped.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), '.xlsx'), /解压.*32 MiB/);
});

test('readingOffice：XLSX 保留工作表、稀疏位置、类型，以及未重算的公式和缓存', async () => {
  const { Workbook } = require('exceljs');
  const { readSpreadsheet } = require('../../src/main/services/spreadsheet.ts');
  const book = new Workbook(), first = book.addWorksheet('订单'), second = book.addWorksheet('汇总');
  first.addRow(['编号', '数量', '生效']); first.addRow(['0012', 3, true]);
  first.getCell('D4').value = new Date('2026-09-09T00:00:00.000Z');
  second.getCell('A1').value = { formula: "'订单'!B2*2", result: 6 };
  second.getCell('A2').value = { formula: 'SUM(2,3)' };
  second.getCell('B1').value = { error: '#DIV/0!' };
  const value = await readSpreadsheet(Buffer.from(await book.xlsx.writeBuffer()), '.xlsx');
  assert.deepEqual(value.sheets.map(sheet => sheet.name), ['订单', '汇总']);
  assert.equal(value.sheets[0].rowCount, 4); assert.equal(value.sheets[0].columnCount, 4);
  assert.equal(value.sheets[0].rows[1][0].value, '0012');
  assert.equal(value.sheets[0].rows[1][1].type, 'number');
  assert.equal(value.sheets[0].rows[1][2].value, true);
  assert.equal(value.sheets[0].rows[2][3].value, null);
  assert.equal(value.sheets[0].rows[3][3].value, '2026-09-09T00:00:00.000Z');
  assert.deepEqual(value.sheets[1].rows[0][0], { type: 'formula', value: null, formula: "'订单'!B2*2", cached: 6 });
  assert.equal(value.sheets[1].rows[1][0].cached, null);
  assert.equal(value.sheets[1].rows[0][1].type, 'error');
  assert.equal(value.formulaStatus, 'not-recalculated');
});

test('readingOffice：真实挂起子进程超时后已退出，不继承密钥、代理或 Node 注入环境', { timeout: 20000 }, async t => {
  const childProcess = require('node:child_process'), original = childProcess.spawn;
  const { readSpreadsheet } = require('../../src/main/services/spreadsheet.ts');
  let child, supplied;
  childProcess.spawn = (exe, args, options) => {
    supplied = options;
    // 只替换解析器边界为合成挂起进程；启动、环境、超时和终止仍经过产品实现。
    child = original(exe, ['-e', 'process.stdin.resume();setInterval(()=>{},1000)'], options);
    return child;
  };
  t.after(() => { childProcess.spawn = original; if (child?.exitCode === null) child.kill(); });
  await assert.rejects(readSpreadsheet(Buffer.from('A\n1'), '.csv'), /超过 10 秒/);
  assert.ok(Object.keys(supplied.env).every(key => /^(SystemRoot|WINDIR|TEMP|TMP|ELECTRON_RUN_AS_NODE)$/i.test(key)));
  assert.equal(supplied.shell, false); assert.equal(supplied.windowsHide, true);
  assert.throws(() => process.kill(child.pid, 0), error => error.code === 'ESRCH');
});
