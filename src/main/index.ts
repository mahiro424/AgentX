import { ProjectService } from './services/projects';
import { PROJECT_RENAME_CHANNEL, PROJECT_CHOOSE_CHANNEL, WORKSPACE_CHANGED_CHANNEL, WORKSPACE_READ_CHANNEL } from '../shared/contracts/projects';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { APP_INFO_CHANNEL, PREFERENCES_READ_CHANNEL, PREFERENCES_SAVE_CHANNEL, type AppInfo, type Preferences } from '../shared/contracts/app';
import { readPreferences, savePreferences } from './storage/preferences';
import { MODEL_SETTINGS_CHANGED_CHANNEL, MODEL_TEST_CHANNEL, MODEL_SETTINGS_READ_CHANNEL, MODEL_KEY_SAVE_CHANNEL, MODEL_KEY_REVEAL_CHANNEL, MODEL_SETTINGS_VISIBLE_CHANNEL, MODEL_ENABLED_CHANNEL, MODEL_CATALOG_FETCH_CHANNEL, MODEL_SELECTION_CHANNEL, MODEL_ACTIVE_CHANNEL } from '../shared/contracts/models';
import { ModelService } from './services/models';

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
const projects = new ProjectService(dataRoot);
const models = new ModelService(dataRoot);
let modelSettingsVisible = false;

function requireProductFrame(event: Electron.IpcMainInvokeEvent, actualCount: number, expectedCount: number): void {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame ||
      event.senderFrame.url !== mainWindowURL || actualCount !== expectedCount) {
    throw new Error('拒绝非产品主页面或无效参数的请求');
  }
}

async function changeModels<T>(action: () => T | Promise<T>): Promise<T> {
  const notify = () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.getURL() === mainWindowURL) {
      mainWindow.webContents.send(MODEL_SETTINGS_CHANGED_CHANNEL);
    }
  };
  try { const result = action(); notify(); return await result; }
  finally { notify(); }
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
  window.on('blur', () => { modelSettingsVisible = false; });
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
    ipcMain.handle(PROJECT_RENAME_CHANNEL, (event, ...args) => {
      requireProductFrame(event, args.length, 1);
      const result = projects.rename(args[0]);
      mainWindow!.webContents.send(WORKSPACE_CHANGED_CHANNEL);
      return result;
    });
    ipcMain.handle(PROJECT_CHOOSE_CHANNEL, async (event, ...args) => {
      requireProductFrame(event, args.length, 1);
      const result = await projects.choose(mainWindow!, args[0]);
      if (result.status !== 'cancelled' && mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.getURL() === mainWindowURL) {
        mainWindow.webContents.send(WORKSPACE_CHANGED_CHANNEL);
      }
      return result;
    });
    ipcMain.handle(WORKSPACE_READ_CHANNEL, (event, ...args) => {
      requireProductFrame(event, args.length, 0);
      return projects.read();
    });
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
    ipcMain.handle(MODEL_SETTINGS_READ_CHANNEL, (event, ...args) => {
      requireProductFrame(event, args.length, 0);
      return models.read();
    });
    ipcMain.handle(MODEL_KEY_SAVE_CHANNEL, (event, ...args) => {
      requireProductFrame(event, args.length, 1);
      return changeModels(() => models.saveKey(args[0]));
    });
    ipcMain.handle(MODEL_SETTINGS_VISIBLE_CHANNEL, (event, ...args) => {
      requireProductFrame(event, args.length, 1);
      if (typeof args[0] !== 'boolean') throw new Error('设置页面状态无效');
      modelSettingsVisible = args[0] && !!mainWindow?.isFocused();
    });
    ipcMain.handle(MODEL_ENABLED_CHANNEL, (event, ...args) => {
      requireProductFrame(event, args.length, 1);
      return changeModels(() => models.setEnabled(args[0]));
    });
    ipcMain.handle(MODEL_SELECTION_CHANNEL, (event, ...args) => {
      requireProductFrame(event, args.length, 1);
      return changeModels(() => models.setSelection(args[0]));
    });
    ipcMain.handle(MODEL_ACTIVE_CHANNEL, (event, ...args) => {
      requireProductFrame(event, args.length, 1);
      return changeModels(() => models.setActive(args[0]));
    });
    ipcMain.handle(MODEL_TEST_CHANNEL, (event, ...args) => {
      requireProductFrame(event, args.length, 1);
      return changeModels(() => models.test(args[0]));
    });
    ipcMain.handle(MODEL_CATALOG_FETCH_CHANNEL, (event, ...args) => {
      requireProductFrame(event, args.length, 1);
      return changeModels(() => models.fetchCatalog(args[0]));
    });
    ipcMain.handle(MODEL_KEY_REVEAL_CHANNEL, async (event, ...args) => {
      requireProductFrame(event, args.length, 1);
      if (!modelSettingsVisible || !mainWindow?.isFocused()) throw new Error('只能在前台模型设置中查看密钥');
      const plaintext = await models.reveal(args[0]);
      if (!modelSettingsVisible || !mainWindow?.isFocused()) throw new Error('已离开安全显示环境，本次不返回密钥');
      return plaintext;
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
