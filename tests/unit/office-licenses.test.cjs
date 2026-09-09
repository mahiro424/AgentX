const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('办公依赖打包：锁定生产依赖保留完整许可，包含 ExcelJS 与 ZIP/XML 传递依赖', async () => {
  const { prepareOfficeLicenses } = require('../../scripts/prepare-office-licenses.cjs');
  const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'agentx-office-license-'));
  const filename = await prepareOfficeLicenses(destination);
  const text = await fs.readFile(filename, 'utf8');
  assert.match(text, /exceljs@4\.4\.0/); assert.match(text, /Copyright \(c\) 2014-2019 Guyon Roche/);
  assert.match(text, /unzipper@0\.12\.3/); assert.match(text, /Near Infinity Corporation/);
  assert.match(text, /saxes@5\.0\.1/); assert.match(text, /Isaac Z\. Schlueter and Contributors/);
  assert.match(text, /uuid@11\.1\.1/); assert.match(text, /isarray@1\.0\.0/);
  assert.match(text, /mammoth@1\.12\.2/); assert.match(text, /docx@9\.7\.1/);
  assert.match(text, /hash\.js@1\.1\.7/); assert.match(text, /Copyright Fedor Indutny, 2014/);
  assert.match(text, /dingbat-to-unicode@1\.0\.1/); assert.match(text, /不冒充上游原始 LICENSE/);
  assert.doesNotMatch(text, /^(@electron-forge\/[^\r\n]+|ts-node)@/m);
});
