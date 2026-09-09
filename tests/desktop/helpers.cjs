const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { _electron } = require('playwright-core');
const { once } = require('node:events');

const root = path.resolve(__dirname, '../..');
const artifacts = path.join(root, '.local-validation/foundation');
const diagnosticReports = new WeakMap();

// AXUI 临时诊断：仅测合成测试窗口事件循环与点击到达，不输出正文或凭据。
async function observeTestWindow(app, page) {
  const install = () => {
    const metric = { maximumGap: 0, clicks: 0, elapsed: 0 }, started = Date.now(); let last = started;
    const timer = setInterval(() => { const now = Date.now(); metric.maximumGap = Math.max(metric.maximumGap, now - last); metric.elapsed = now - started; last = now; }, 100);
    if (timer.unref) timer.unref();
    globalThis.axUiMetric = metric;
    if (typeof document !== 'undefined') document.addEventListener('click', () => metric.clicks++, true);
  };
  await app.evaluate(install); await page.evaluate(install);
  const report = async () => {
    diagnosticReports.delete(app);
    let timer;
    try {
      const values = await Promise.race([Promise.all([
        app.evaluate(() => globalThis.axUiMetric),
        page.evaluate(() => ({ ...globalThis.axUiMetric, focused: document.hasFocus(), visibility: document.visibilityState })),
      ]), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('读取超时')), 2000); })]);
      console.log('AXUI ' + JSON.stringify({ main: values[0], renderer: values[1] }));
    } catch { console.log('AXUI 诊断读取未完成'); }
    finally { clearTimeout(timer); }
  };
  diagnosticReports.set(app, report);
  const close = app.close.bind(app);
  app.close = async () => { if (diagnosticReports.has(app)) await report(); return close(); };
}

async function launch(existingData) {
  await fs.mkdir(artifacts, { recursive: true });
  const data = existingData ?? await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'agentx-desktop-test-')));
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
    if (process.env.AGENTX_CI_OBSERVE === '1') await observeTestWindow(app, page);
    return { app, page, data };
  } catch (error) {
    await app.close();
    throw error;
  }
}

async function crashTestApp(app) {
  if (app.process().exitCode !== null) return;
  await diagnosticReports.get(app)?.();
  const exited = once(app.process(), 'exit');
  // 仅销毁调用方测试创建的合成未决/损坏实例，不计为产品正常退出通过。
  await app.evaluate(({ app }) => { setImmediate(() => app.exit(0)); });
  await exited;
}

module.exports = { launch, crashTestApp };
