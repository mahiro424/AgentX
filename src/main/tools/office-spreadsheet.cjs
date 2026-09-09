const { Workbook } = require('exceljs');
const { Readable } = require('node:stream');
const { Open } = require('unzipper');

async function checkArchive(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) throw new Error('加密或旧版 Office 文件暂不支持');
  const archive = await Open.buffer(bytes);
  if (!archive.files.some(file => file.path === 'xl/workbook.xml')) throw new Error('不是有效 XLSX 工作簿');
  if (archive.files.length > 2000) throw new Error('XLSX 压缩条目超限');
  let expanded = 0;
  for (const file of archive.files) {
    if (file.flags & 1) throw new Error('加密 XLSX 暂不支持');
    if (/vbaProject\.bin$/i.test(file.path)) throw new Error('包含宏的工作簿暂不支持');
    if (file.uncompressedSize > 32 * 1024 * 1024) throw new Error('XLSX 解压内容最多 32 MiB');
    // 不落盘；按实际解压字节累计，不能只信任压缩包声明的大小。
    for await (const chunk of file.stream()) {
      expanded += chunk.length;
      if (expanded > 32 * 1024 * 1024) throw new Error('XLSX 解压内容最多 32 MiB');
    }
  }
}

async function read(bytes, extension) {
  const workbook = new Workbook();
  if (extension === '.xlsx') { await checkArchive(bytes); await workbook.xlsx.load(bytes); }
  else if (extension === '.csv') {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('CSV 不是有效 UTF-8，请转换编码后重新添加'); }
    if (text.includes('\0')) throw new Error('CSV 包含无效二进制内容');
    await workbook.csv.read(Readable.from([text]), { map: value => value, sheetName: 'CSV' });
  } else throw new Error('表格格式尚未开放');
  if (workbook.worksheets.length > 16) throw new Error('表格最多 16 个工作表');
  let cells = 0;
  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount > 2000 || sheet.columnCount > 100) throw new Error('每个工作表最多 2000 行、100 列');
    cells += sheet.rowCount * sheet.columnCount;
    if (cells > 100000) throw new Error('表格总计最多 100000 个预览单元格');
  }
  const scalar = value => {
    if (value == null) return null;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('表格包含无效数值，未将其改写为空单元格');
    if (['string', 'number', 'boolean'].includes(typeof value)) return value;
    if (value.error) return value.error;
    if (value.richText) return value.richText.map(run => run.text).join('');
    if (value.text !== undefined) return String(value.text);
    throw new Error('表格含暂不支持的单元格类型');
  };
  return { format: extension.slice(1), parserPid: process.pid, formulaStatus: 'not-recalculated', sheets: workbook.worksheets.map(sheet => ({
    name: sheet.name, state: sheet.state, rowCount: sheet.rowCount, columnCount: sheet.columnCount,
    rows: Array.from({length: sheet.rowCount}, (_, row) => Array.from({length: sheet.columnCount}, (_, column) => {
      const cell = sheet.getCell(row + 1, column + 1), value = cell.value;
      if (cell.isMerged && cell.master !== cell) return { type: 'merged', value: null, formula: null, cached: null, mergedInto: cell.master.address };
      if (cell.formula) return { type: 'formula', value: null, formula: cell.formula, cached: scalar(cell.result) };
      const type = value === null ? 'empty' : value instanceof Date ? 'date' : value.error ? 'error' :
        typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'text';
      return { type, value: scalar(value), formula: null, cached: null };
    })),
  })) };
}

async function write(spec, extension) {
  if (!['.csv', '.xlsx'].includes(extension)) throw new Error('仅能生成 CSV 或 XLSX');
  if (!spec || Object.keys(spec).length !== 1 || !Array.isArray(spec.sheets) || !spec.sheets.length || spec.sheets.length > 16) throw new Error('生成内容需包含 1 至 16 个工作表');
  if (extension === '.csv' && spec.sheets.length !== 1) throw new Error('CSV 仅支持一个工作表，不会静默丢弃其他工作表');
  const workbook = new Workbook(), names = new Set();
  let cells = 0;
  const scalar = value => value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 32767);
  const cellValue = value => {
    if (extension === '.csv' && typeof value === 'string' && /^[\s\uFEFF]*[=+@-]/u.test(value)) throw new Error('CSV 含公式样式文本，请改用 XLSX 保留原值；未静默转义');
    if (scalar(value)) return value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('不支持的单元格内容');
    if (Object.keys(value).length === 1 && typeof value.date === 'string' && Number.isFinite(Date.parse(value.date))) return new Date(value.date);
    if (typeof value.formula === 'string' && value.formula.length > 0 && value.formula.length <= 8192 &&
        Object.keys(value).every(key => ['formula', 'result'].includes(key)) && (!('result' in value) || scalar(value.result))) {
      if (extension === '.csv') throw new Error('CSV 不保留公式，请改用 XLSX 或提供已核对的静态值');
      return value;
    }
    throw new Error('不支持的单元格内容；使用标量、日期或公式与缓存');
  };
  for (const specSheet of spec.sheets) {
    if (!specSheet || Object.keys(specSheet).some(key => !['name', 'rows'].includes(key)) ||
        typeof specSheet.name !== 'string' || !specSheet.name || specSheet.name.length > 31 || /[\\/*?:\[\]\u0000-\u001f]/u.test(specSheet.name) || /^'|'$/.test(specSheet.name) || names.has(specSheet.name.toLowerCase()) ||
        !Array.isArray(specSheet.rows) || specSheet.rows.length > 2000 || specSheet.rows.some(row => !Array.isArray(row) || row.length > 100)) throw new Error('工作表名称、行列或格式无效');
    names.add(specSheet.name.toLowerCase());
    cells += specSheet.rows.length * Math.max(0, ...specSheet.rows.map(row => row.length));
    if (cells > 100000) throw new Error('表格总计最多 100000 个单元格');
    const sheet = workbook.addWorksheet(specSheet.name);
    for (const row of specSheet.rows) sheet.addRow(row.map(cellValue));
  }
  const bytes = Buffer.from(extension === '.xlsx' ? await workbook.xlsx.writeBuffer() : await workbook.csv.writeBuffer({ sheetName: spec.sheets[0].name }));
  if (bytes.length > 8 * 1024 * 1024) throw new Error('生成文件超过 8 MiB');
  // 回读只能核对格式和结构，不能证明业务目标或公式计算结果正确。
  const validated = await read(bytes, extension);
  return { bytes, sheets: validated.sheets.map(sheet => ({ name: sheet.name, rowCount: sheet.rowCount, columnCount: sheet.columnCount })) };
}

module.exports = { read, write };
