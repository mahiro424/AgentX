const { _electron } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

// 只采集本次打包应用的真实客户区，不读取正式数据，不把截图作为设计批准。
async function capture() {
  const root = path.resolve(__dirname, '../..');
  const output = path.join(root, 'docs/validation/m1-01');
  const temporary = path.join(root, '.local-validation/foundation');
  await fs.mkdir(output, { recursive: true });
  await fs.mkdir(temporary, { recursive: true });
  const data = await fs.mkdtemp(path.join(temporary, 'capture-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|TOKEN|SECRET|PASSWORD|ELECTRON_RUN_AS_NODE/i.test(key)));
  const app = await _electron.launch({ executablePath: path.join(root, 'out/AgentX-win32-x64/AgentX.exe'), env: { ...env, AGENTX_DATA_DIR: data }, colorScheme: null, timeout: 30000 });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('load');
    page.setDefaultTimeout(5000);
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.setSize(1280, 820); });
    await page.waitForFunction(() => innerWidth === 1280);
    const shots = [];
    const screenshot = async (name, label) => {
      if (!await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) throw new Error(`截图存在横向溢出：${name}`);
      const view = await app.evaluate(({ BrowserWindow, nativeTheme, screen }) => {
        const window = BrowserWindow.getAllWindows()[0];
        const bounds = window.getBounds();
        return { width: bounds.width, height: bounds.height, theme: nativeTheme.themeSource, zoom: window.webContents.getZoomFactor(), displayScaleFactor: screen.getDisplayMatching(bounds).scaleFactor };
      });
      await page.screenshot({ path: path.join(output, name) });
      shots.push({ file: name, label, ...view });
    };
    const theme = async (value, label) => {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, value);
      await page.getByRole('button', { name: '返回工作台', exact: true }).click();
    };
    await theme('light', '浅色');
    await screenshot('workbench-light-1280.png', '浅色空工作台，1280×820');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await screenshot('settings-light-1280.png', '浅色通用设置，1280×820');
    await page.getByRole('button', { name: '返回工作台', exact: true }).click();
    await theme('dark', '深色');
    await screenshot('workbench-dark-1280.png', '深色空工作台，1280×820');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
    await page.getByRole('complementary', { name: '侧栏' }).waitFor({ state: 'hidden' });
    await screenshot('workbench-dark-960.png', '深色紧凑工作台，960×640');
    await theme('system', '跟随系统');
    const native = await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors);
    await page.waitForFunction(dark => matchMedia('(prefers-color-scheme: dark)').matches === dark, native);
    const info = await page.evaluate(() => window.agentx.getAppInfo());
    const versions = await app.evaluate(() => ({ electron: process.versions.electron, node: process.versions.node }));
    const archive = await fs.readFile(path.join(root, 'out/AgentX-win32-x64/resources/app.asar'));
    await fs.writeFile(path.join(output, 'capture.json'), JSON.stringify({ generatedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), archiveSha256: createHash('sha256').update(archive).digest('hex'), buildNodeVersion: process.versions.node, info, runtimeVersions: versions, kind: '本机真实 Electron 客户区截图，非 CI 截图或设计稿；不含原生窗口边框', manualDesignReview: '待用户检查', shots }, null, 2) + '\n', 'utf8');
    console.log('已采集 4 张真实窗口截图；浅色、深色及跟随系统均已操作核对。');
  } finally { await app.close(); }
}

capture().catch(error => { console.error(error); process.exitCode = 1; });
