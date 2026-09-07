export const APP_INFO_CHANNEL = 'agentx:app-info';
export const PREFERENCES_READ_CHANNEL = 'agentx:preferences-read';
export const PREFERENCES_SAVE_CHANNEL = 'agentx:preferences-save';

export interface Preferences {
  theme: 'system' | 'light' | 'dark';
  zoom: number;
}

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  stage: 'foundation';
}

export interface AgentXBridge {
  getAppInfo(): Promise<AppInfo>;
  getPreferences(): Promise<Preferences>;
  savePreferences(value: Preferences): Promise<Preferences>;
}
