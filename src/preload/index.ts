import { contextBridge, ipcRenderer } from 'electron';
import { APP_INFO_CHANNEL, PREFERENCES_READ_CHANNEL, PREFERENCES_SAVE_CHANNEL, type AgentXBridge, type AppInfo, type Preferences } from '../shared/contracts/app';

const bridge: AgentXBridge = Object.freeze({
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(APP_INFO_CHANNEL),
  getPreferences: (): Promise<Preferences> => ipcRenderer.invoke(PREFERENCES_READ_CHANNEL),
  savePreferences: (value: Preferences): Promise<Preferences> => ipcRenderer.invoke(PREFERENCES_SAVE_CHANNEL, value),
});

contextBridge.exposeInMainWorld('agentx', bridge);
