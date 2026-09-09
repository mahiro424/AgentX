const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { read, write } = require('./office-spreadsheet.cjs');
const maximumBytes = 8 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

async function readFile(filename) {
  const canonical = await fs.realpath(path.resolve(filename)), initial = await fs.lstat(canonical);
  if (!initial.isFile() || initial.size > maximumBytes) throw new Error('输入必须是至多 8 MiB 的普通文件');
  const file = await fs.open(canonical, 'r');
  try {
    if (!same(initial, await file.stat())) throw new Error('文件版本在读取时变化');
    const buffer = Buffer.alloc(initial.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== initial.size || !same(initial, await file.stat()) || !same(initial, await fs.lstat(canonical)) || await fs.realpath(canonical) !== canonical) throw new Error('文件版本在读取时变化');
    return { bytes: buffer.subarray(0, length), canonical };
  } finally { await file.close(); }
}

// 工具只新建当前工作目录的文件；不会覆盖原件或穿过输出目录链接。
async function writeNew(name, bytes) {
  if (typeof name !== 'string' || !name || name !== path.basename(name) || /[\\/:\u0000-\u001f\u007f]/u.test(name) || /[. ]$/.test(name)) throw new Error('输出必须是当前工作目录内的新文件名');
  if (bytes.length > maximumBytes) throw new Error('输出超过 8 MiB，未保存截断内容');
  const directory = await fs.realpath(process.cwd()), filename = path.join(directory, name);
  const file = await fs.open(filename, 'wx');
  try { await file.writeFile(bytes); await file.sync(); }
  finally { await file.close(); }
  return { path: filename, sha256: hash(bytes), size: bytes.length };
}

async function main(args) {
  if (args[0] === 'read' && args.length === 4) {
    const [, source, expectedSha, output] = args;
    if (!/^[a-f0-9]{64}$/.test(expectedSha) || path.extname(output).toLowerCase() !== '.json') throw new Error('读取需要材料 SHA-256 和新的 JSON 文件名');
    const { bytes, canonical } = await readFile(source);
    if (hash(bytes) !== expectedSha) throw new Error('材料版本已变化，未继续读取或生成');
    const result = await read(bytes, path.extname(canonical).toLowerCase());
    return { ...await writeNew(output, Buffer.from(JSON.stringify(result))), sourceSha256: expectedSha, formulaStatus: result.formulaStatus };
  }
  if (args[0] === 'write' && args.length === 3) {
    const [, source, output] = args;
    const { bytes: input } = await readFile(source);
    let spec;
    try { spec = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input)); }
    catch { throw new Error('生成内容必须是有效 UTF-8 JSON'); }
    const result = await write(spec, path.extname(output).toLowerCase());
    return { ...await writeNew(output, result.bytes), sheets: result.sheets, validation: 'structure-only', formulaStatus: 'not-recalculated' };
  }
  throw new Error('用法：read <材料路径> <SHA-256> <新 JSON 文件名> 或 write <内容 JSON 路径> <新 CSV/XLSX 文件名>');
}

// 由引擎既有命令执行拥有该进程；本入口不启动第二套执行循环。
const timeout = setTimeout(() => { process.stderr.write('表格工具超过 30 秒，进程终止；可能留下未验证的部分文件'); process.exit(1); }, 30000);
main(process.argv.slice(2)).then(result => process.stdout.write(JSON.stringify(result))).catch(error => {
  process.stderr.write(error instanceof Error ? error.message : '表格工具失败'); process.exitCode = 1;
}).finally(() => clearTimeout(timeout));
