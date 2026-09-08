const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron } = require('playwright-core');

const root = path.resolve(__dirname, '../..');
const artifacts = path.join(root, '.local-validation/foundation');

async function launch(existingData) {
  await fs.mkdir(artifacts, { recursive: true });
  const data = existingData ?? await fs.mkdtemp(path.join(artifacts, 'electron-data-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|TOKEN|SECRET|PASSWORD|ELECTRON_RUN_AS_NODE/i.test(key)));
  const app = await _electron.launch({
    executablePath: path.join(root, 'out/AgentX-win32-x64/AgentX.exe'),
    env: { ...env, AGENTX_DATA_DIR: data },
    // 使用真实系统主题，不让 Playwright 默认的浅色媒体模拟覆盖 nativeTheme。
    colorScheme: null,
    timeout: 30000,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('load');
    page.setDefaultTimeout(5000);
    // 虚拟显示器可能限制首次显示尺寸，测试显式设置真实窗口，不能假定构造参数就是视口。
    const geometry = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const before = window.getSize();
      window.show();
      window.setSize(1280, 820);
      return { before, after: window.getSize() };
    });
    if (!existingData) await page.waitForFunction(() => innerWidth === 1280);
    console.log(`桌面测试尺寸：${JSON.stringify(geometry)}`);
    return { app, page, data };
  } catch (error) {
    await app.close();
    throw error;
  }
}

module.exports = { launch };
