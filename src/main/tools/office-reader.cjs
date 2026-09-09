const { read } = require('./office-spreadsheet.cjs');
const { readDocument } = require('./office-document.cjs');

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
    const result = await (request.extension === '.docx' ? readDocument : read)(Buffer.from(request.bytes, 'base64'), request.extension);
    const output = JSON.stringify(result);
    if (Buffer.byteLength(output) > 8 * 1024 * 1024) throw new Error('表格内容超限，未返回截断表格');
    process.stdout.write(output);
  } catch (error) { process.stderr.write(error instanceof Error ? error.message : '表格解析失败'); process.exitCode = 1; }
});
