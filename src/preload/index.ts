import { contextBridge, ipcRenderer } from 'electron';
import { APP_INFO_CHANNEL, PREFERENCES_READ_CHANNEL, PREFERENCES_SAVE_CHANNEL, type AgentXBridge, type AppInfo, type Preferences } from '../shared/contracts/app';
import { MODEL_SETTINGS_CHANGED_CHANNEL, MODEL_TEST_CHANNEL, type ModelTestRequest, MODEL_SETTINGS_READ_CHANNEL, MODEL_KEY_SAVE_CHANNEL, MODEL_KEY_REVEAL_CHANNEL, MODEL_SETTINGS_VISIBLE_CHANNEL, MODEL_ENABLED_CHANNEL, MODEL_CATALOG_FETCH_CHANNEL, MODEL_SELECTION_CHANNEL, MODEL_ACTIVE_CHANNEL, type ModelSelectionChange, type ActiveModelChange, type ConnectionChange, type KeySubmission, type ModelOperation, type ModelSettings } from '../shared/contracts/models';

const bridge: AgentXBridge = Object.freeze({
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(APP_INFO_CHANNEL),
  getPreferences: (): Promise<Preferences> => ipcRenderer.invoke(PREFERENCES_READ_CHANNEL),
  savePreferences: (value: Preferences): Promise<Preferences> => ipcRenderer.invoke(PREFERENCES_SAVE_CHANNEL, value),
  saveModelKey: (value: KeySubmission): Promise<ModelSettings> => ipcRenderer.invoke(MODEL_KEY_SAVE_CHANNEL, value),
  setModelSettingsVisible: (visible: boolean): Promise<void> => ipcRenderer.invoke(MODEL_SETTINGS_VISIBLE_CHANNEL, visible),
  revealModelKey: (revision: number): Promise<string> => ipcRenderer.invoke(MODEL_KEY_REVEAL_CHANNEL, revision),
  setModelConnectionEnabled: (value: ConnectionChange): Promise<ModelSettings> => ipcRenderer.invoke(MODEL_ENABLED_CHANNEL, value),
  setSelectedModels: (value: ModelSelectionChange): Promise<ModelSettings> => ipcRenderer.invoke(MODEL_SELECTION_CHANNEL, value),
  setActiveModel: (value: ActiveModelChange): Promise<ModelSettings> => ipcRenderer.invoke(MODEL_ACTIVE_CHANNEL, value),
  fetchModelCatalog: (value: ModelOperation): Promise<ModelSettings> => ipcRenderer.invoke(MODEL_CATALOG_FETCH_CHANNEL, value),
  onModelSettingsChanged: (listener: () => void): (() => void) => {
    if (typeof listener !== 'function') throw new Error('模型状态监听器无效');
    const notify = () => listener();
    ipcRenderer.on(MODEL_SETTINGS_CHANGED_CHANNEL, notify);
    return () => ipcRenderer.removeListener(MODEL_SETTINGS_CHANGED_CHANNEL, notify);
  },
  testModel: (value: ModelTestRequest): Promise<ModelSettings> => ipcRenderer.invoke(MODEL_TEST_CHANNEL, value),
  getModelSettings: (): Promise<ModelSettings> => ipcRenderer.invoke(MODEL_SETTINGS_READ_CHANNEL),
});

contextBridge.exposeInMainWorld('agentx', bridge);
