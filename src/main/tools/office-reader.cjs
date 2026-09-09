const { read } = require('./office-spreadsheet.cjs');
const { readDocument } = require('./office-document.cjs');
const { readPdf } = require('./office-pdf.cjs');

// 库诊断走 stderr，stdout 始终只有一份可关联的 JSON。
console.log = (...values) => process.stderr.write(values.join(' ') + '\n');

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
    const result = await (request.extension === '.pdf' ? readPdf : request.extension === '.docx' ? readDocument : read)(Buffer.from(request.bytes, 'base64'), request.extension);
    const output = JSON.stringify(result);
    if (Buffer.byteLength(output) > 8 * 1024 * 1024) throw new Error('表格内容超限，未返回截断表格');
    process.stdout.write(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : '办公解析失败';
    process.stdout.write(JSON.stringify({ parserPid: process.pid, error: message.slice(0, 2048) }));
    process.stderr.write(message); process.exitCode = 1;
  }
});
