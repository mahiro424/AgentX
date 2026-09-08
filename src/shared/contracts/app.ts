import type { ProjectChoice, ProjectOperation, ProjectRename, ProjectRecord, WorkspaceSnapshot } from './projects';
import type { ModelTestRequest, ActiveModelChange, ConnectionChange, KeySubmission, ModelOperation, ModelSelectionChange, ModelSettings } from './models';

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
  renameProject(value: ProjectRename): Promise<ProjectRecord>;
  chooseProject(value: ProjectOperation): Promise<ProjectChoice>;
  onWorkspaceChanged(listener: () => void): () => void;
  getWorkspace(): Promise<WorkspaceSnapshot>;
  getAppInfo(): Promise<AppInfo>;
  getPreferences(): Promise<Preferences>;
  savePreferences(value: Preferences): Promise<Preferences>;
  onModelSettingsChanged(listener: () => void): () => void;
  testModel(value: ModelTestRequest): Promise<ModelSettings>;
  getModelSettings(): Promise<ModelSettings>;
  saveModelKey(value: KeySubmission): Promise<ModelSettings>;
  setModelSettingsVisible(visible: boolean): Promise<void>;
  revealModelKey(expectedRevision: number): Promise<string>;
  setModelConnectionEnabled(value: ConnectionChange): Promise<ModelSettings>;
  fetchModelCatalog(value: ModelOperation): Promise<ModelSettings>;
  setSelectedModels(value: ModelSelectionChange): Promise<ModelSettings>;
  setActiveModel(value: ActiveModelChange): Promise<ModelSettings>;
}
