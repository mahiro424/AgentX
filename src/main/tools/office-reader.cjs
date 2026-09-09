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

let input = '', size = 0;
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  size += Buffer.byteLength(chunk);
  if (size > 12 * 1024 * 1024) { process.stderr.write('表格输入超限'); process.exit(1); }
  input += chunk;
});
process.stdin.on('end', async () => {
  try {
    const request = JSON.parse(input);
    if (typeof request.bytes !== 'string' || typeof request.extension !== 'string') throw new Error('表格解析请求无效');
    const result = await read(Buffer.from(request.bytes, 'base64'), request.extension);
    const output = JSON.stringify(result);
    if (Buffer.byteLength(output) > 8 * 1024 * 1024) throw new Error('表格内容超限，未返回截断表格');
    process.stdout.write(output);
  } catch (error) { process.stderr.write(error instanceof Error ? error.message : '表格解析失败'); process.exitCode = 1; }
});
