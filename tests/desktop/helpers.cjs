const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron } = require('playwright-core');
const { once } = require('node:events');

const root = path.resolve(__dirname, '../..');
const artifacts = path.join(root, '.local-validation/foundation');

async function launch(existingData) {
  await fs.mkdir(artifacts, { recursive: true });
  const data = existingData ?? await fs.mkdtemp(path.join(artifacts, 'electron-data-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|TOKEN|SECRET|PASSWORD|ELECTRON_RUN_AS_NODE/i.test(key)));
  const app = await _electron.launch({
    executablePath: path.join(process.env.AGENTX_TEST_PACKAGE_DIR ?? path.join(root, 'out/AgentX-win32-x64'), 'AgentX.exe'),
    env: { ...env, AGENTX_DATA_DIR: data },
    // 使用真实系统主题，不让 Playwright 默认的浅色媒体模拟覆盖 nativeTheme。
    colorScheme: null,
    timeout: 30000,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('load');
    page.setDefaultTimeout(5000);
    // 等产品自己的 ready-to-show；抢先 show 会让晚到的启动回调恢复已最小化窗口。
    await app.evaluate(({ BrowserWindow }) => new Promise((resolve, reject) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window.isVisible()) { resolve(); return; }
      const timer = setTimeout(() => reject(new Error('产品窗口未完成首次显示')), 10000);
      window.once('ready-to-show', () => { clearTimeout(timer); resolve(); });
    }));
    // 虚拟显示器可能限制首次显示尺寸，测试显式设置真实窗口，不能假定构造参数就是视口。
    const geometry = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const before = window.getSize();
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

async function crashTestApp(app) {
  if (app.process().exitCode !== null) return;
  const exited = once(app.process(), 'exit');
  // 仅销毁调用方测试创建的合成未决/损坏实例，不计为产品正常退出通过。
  await app.evaluate(({ app }) => { setImmediate(() => app.exit(0)); });
  await exited;
}

module.exports = { launch, crashTestApp };
