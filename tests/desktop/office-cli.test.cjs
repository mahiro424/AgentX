const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const { Workbook } = require('exceljs');

test('打包表格命令：真实 Windows PowerShell 仅靠随包 Electron 运行，读取和生成均可核对', { timeout: 45000 }, async t => {
  const directory = path.resolve(process.env.AGENTX_TEST_PACKAGE_DIR || 'out/AgentX-win32-x64');
  const exe = path.join(directory, 'AgentX.exe'), cli = path.join(directory, 'resources/app.asar/.webpack/main/office-cli.js');
  const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agentx-sheet '空格-")));
  const source = path.join(cwd, "材料 '中文.csv"), bytes = Buffer.from('编号,金额\n0012,30\n0013,45');
  await fs.writeFile(source, bytes);
  const quoted = value => `'${value.replaceAll("'", "''")}'`;
  const shellDirectory = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0');
  const run = async args => {
    const started = Date.now(); t.diagnostic(`表格命令 ${args[0]}：开始`);
    const script = `[Console]::Error.WriteLine('shell-enter');$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$env:ELECTRON_RUN_AS_NODE='1';[Console]::Error.WriteLine('before-exe'); & ${[exe, '--max-old-space-size=192', cli, ...args].map(quoted).join(' ')} | Out-String;$code=$LASTEXITCODE;[Console]::Error.WriteLine('after-exe');exit $code`;
    try {
      const result = await promisify(execFile)(path.join(shellDirectory, 'powershell.exe'),
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { cwd, windowsHide: true, timeout: 35000, signal: t.signal, maxBuffer: 1024 * 1024,
          env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|WINDIR|TEMP|TMP|PATHEXT)$/i.test(key))),
            PSModulePath: path.join(shellDirectory, 'Modules') } });
      t.diagnostic(`表格命令 ${args[0]}：${Date.now() - started} ms；${result.stderr.trim()}`); return result;
    } catch (error) {
      t.diagnostic(`表格命令 ${args[0]} 失败：${Date.now() - started} ms；code=${error.code} killed=${error.killed} signal=${error.signal}；stderr=${String(error.stderr ?? '').slice(-1500)}；stdoutBytes=${Buffer.byteLength(error.stdout ?? '')}`);
      throw error;
    }
  };
  const read = JSON.parse((await run(['read', source, createHash('sha256').update(bytes).digest('hex'), '读取.json'])).stdout.replace(/^\uFEFF/, ''));
  const parsed = JSON.parse(await fs.readFile(read.path, 'utf8'));
  assert.equal(parsed.sheets[0].rows[1][0].value, '0012');
  const sum = parsed.sheets[0].rows.slice(1).reduce((total, row) => total + Number(row[1].value), 0);
  await fs.writeFile(path.join(cwd, '生成.json'), JSON.stringify({ sheets: [{ name: '汇总', rows: [['总额', sum]] }] }));
  const written = JSON.parse((await run(['write', '生成.json', '核对.xlsx'])).stdout.replace(/^\uFEFF/, ''));
  assert.equal(written.validation, 'structure-only');
  const book = new Workbook(); await book.xlsx.load(await fs.readFile(written.path));
  assert.equal(book.worksheets[0].getCell('B1').value, 75);
  assert.deepEqual(await fs.readFile(source), bytes);
  await assert.rejects(run(['write', '生成.json', '核对.xlsx']), error => error.code === 1 && /EEXIST/.test(error.stderr));
});
