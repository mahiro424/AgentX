import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { APP_INFO_CHANNEL, PREFERENCES_READ_CHANNEL, PREFERENCES_SAVE_CHANNEL, type AppInfo, type Preferences } from '../shared/contracts/app';
import { readPreferences, savePreferences } from './storage/preferences';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
// Forge 在 Windows 生成文件路径形式的 URL；与 Chromium 的规范地址比较。
const mainWindowURL = new URL(MAIN_WINDOW_WEBPACK_ENTRY).href;

app.setName('AgentX');
// 自动测试显式传入独立目录；正常使用只访问产品自己的用户目录。
const dataRoot = process.env.AGENTX_DATA_DIR ?? path.join(app.getPath('home'), '.AgentX');
if (!path.isAbsolute(dataRoot)) throw new Error('产品数据目录必须为绝对路径');
fs.mkdirSync(dataRoot, { recursive: true });
app.setPath('userData', dataRoot);
app.setPath('sessionData', path.join(dataRoot, 'chromium'));
app.setAppUserModelId('AgentX');

let mainWindow: BrowserWindow | null = null;

function requireProductFrame(event: Electron.IpcMainInvokeEvent, actualCount: number, expectedCount: number): void {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame ||
      event.senderFrame.url !== mainWindowURL || actualCount !== expectedCount) {
    throw new Error('拒绝非产品主页面或无效参数的请求');
  }
}

function applyPreferences(value: Preferences): void {
  nativeTheme.themeSource = value.theme;
  if (mainWindow && mainWindow.webContents.getZoomFactor() !== value.zoom) {
    mainWindow.webContents.setZoomFactor(value.zoom);
  }
}

function createWindow(): void {
  const colors = () => nativeTheme.shouldUseDarkColors
    ? { color: '#111827', symbolColor: '#F9FAFB' }
    : { color: '#FFFFFF', symbolColor: '#111827' };
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 960, minHeight: 640,
    title: 'AgentX', show: false,
    backgroundColor: colors().color,
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...colors(), height: 44 },
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, webviewTag: false,
    },
  });
  const window = mainWindow;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  const updateTheme = () => {
    if (!window.isDestroyed()) { window.setTitleBarOverlay({ ...colors(), height: 44 }); window.setBackgroundColor(colors().color); }
  };
  nativeTheme.on('updated', updateTheme);
  window.on('closed', () => { nativeTheme.off('updated', updateTheme); mainWindow = null; });
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('AgentX 界面进程退出：', details.reason);
    dialog.showErrorBox('AgentX 界面已停止', '界面进程意外结束，请关闭并重新启动应用。本阶段没有运行中的 Agent 任务。');
  });
  void window.loadURL(mainWindowURL).catch(error => {
    console.error('AgentX 窗口加载失败：', error.message);
    dialog.showErrorBox('AgentX 启动失败', '无法加载本地界面，请检查构建输出后重新启动。');
    app.exit(1);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (mainWindow?.isMinimized()) mainWindow.restore(); mainWindow?.show(); mainWindow?.focus(); });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    ipcMain.handle(APP_INFO_CHANNEL, (event, ...args): AppInfo => {
      // IPC 只接受本产品主页面；相同 URL 的其他窗口也没有这个调用权限。
      requireProductFrame(event, args.length, 0);
      return { name: app.getName(), version: app.getVersion(), platform: process.platform, stage: 'foundation' };
    });
    ipcMain.handle(PREFERENCES_READ_CHANNEL, (event, ...args): Preferences => {
      requireProductFrame(event, args.length, 0);
      const value = readPreferences(dataRoot);
      applyPreferences(value);
      return value;
    });
    ipcMain.handle(PREFERENCES_SAVE_CHANNEL, (event, ...args): Preferences => {
      requireProductFrame(event, args.length, 1);
      const value = savePreferences(dataRoot, args[0]);
      applyPreferences(value);
      return value;
    });
    createWindow();
  }).catch(error => { console.error('AgentX 初始化失败：', error.message); app.exit(1); });
  // 此阶段没有后台执行；真正的托盘保活在对应产品切片实现。
  app.on('window-all-closed', () => app.quit());
}
