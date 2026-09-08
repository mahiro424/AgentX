import { Menu, nativeImage, Tray } from 'electron';

// 本地 16px 托盘标记使用已采用主色，不依赖联网图片或用户文件。
const trayIcon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMElEQVR4nGNQTX79nxLMMIwNQAYkG4CskZAhGAZg04DPENoZgA0MES8MnoQ0dAwAADGUoEu/sc+OAAAAAElFTkSuQmCC';

export function createProductTray(show: () => void, quit: () => void): Tray {
  const image = nativeImage.createFromDataURL(trayIcon);
  if (image.isEmpty()) throw new Error('托盘图标加载失败，不能隐藏窗口');
  const tray = new Tray(image);
  tray.setToolTip('AgentX — 关闭窗口后保留在托盘');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 AgentX', click: show },
    { type: 'separator' },
    { label: '退出 AgentX', click: quit },
  ]));
  tray.on('click', show);
  tray.on('double-click', show);
  return tray;
}
