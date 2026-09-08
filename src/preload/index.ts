import { PROJECT_RENAME_CHANNEL, type ProjectRename, type ProjectRecord, PROJECT_CHOOSE_CHANNEL, WORKSPACE_CHANGED_CHANNEL, type ProjectOperation, type ProjectChoice, WORKSPACE_READ_CHANNEL, type WorkspaceSnapshot } from '../shared/contracts/projects';
import { contextBridge, ipcRenderer } from 'electron';
import { TASK_RESULTS_READ_CHANNEL, type TaskResults, type TaskResultsRequest } from '../shared/contracts/results';
import { TASK_HISTORY_READ_CHANNEL, type TaskHistory, type TaskHistoryRequest } from '../shared/contracts/history';
import { DRAFT_READ_CHANNEL, DRAFT_SAVE_CHANNEL, type DraftScope, type DraftRecord, type DraftSave } from '../shared/contracts/drafts';
import { EXECUTION_READ_CHANNEL, EXECUTION_START_CHANNEL, EXECUTION_STOP_CHANNEL, EXECUTION_CHANGED_CHANNEL, type ExecutionStart, type ExecutionControl, type ExecutionSnapshot } from '../shared/contracts/execution';
import type { TaskSummary } from '../shared/contracts/projects';
import { EXECUTION_STEER_CHANNEL, EXECUTION_APPROVAL_CHANNEL, type ExecutionSteer, type ExecutionApproval } from '../shared/contracts/execution';
import { APP_INFO_CHANNEL, PREFERENCES_READ_CHANNEL, PREFERENCES_SAVE_CHANNEL, type AgentXBridge, type AppInfo, type Preferences } from '../shared/contracts/app';
import { MODEL_SETTINGS_CHANGED_CHANNEL, MODEL_TEST_CHANNEL, type ModelTestRequest, MODEL_SETTINGS_READ_CHANNEL, MODEL_KEY_SAVE_CHANNEL, MODEL_KEY_REVEAL_CHANNEL, MODEL_SETTINGS_VISIBLE_CHANNEL, MODEL_ENABLED_CHANNEL, MODEL_CATALOG_FETCH_CHANNEL, MODEL_SELECTION_CHANNEL, MODEL_ACTIVE_CHANNEL, type ModelSelectionChange, type ActiveModelChange, type ConnectionChange, type KeySubmission, type ModelOperation, type ModelSettings } from '../shared/contracts/models';

const bridge: AgentXBridge = Object.freeze({
  getTaskResults: (value: TaskResultsRequest): Promise<TaskResults> => ipcRenderer.invoke(TASK_RESULTS_READ_CHANNEL, value),
  getTaskHistory: (value: TaskHistoryRequest): Promise<TaskHistory> => ipcRenderer.invoke(TASK_HISTORY_READ_CHANNEL, value),
  getDraft: (value: DraftScope): Promise<DraftRecord> => ipcRenderer.invoke(DRAFT_READ_CHANNEL, value),
  saveDraft: (value: DraftSave): Promise<DraftRecord> => ipcRenderer.invoke(DRAFT_SAVE_CHANNEL, value),
  getExecution: (): Promise<ExecutionSnapshot> => ipcRenderer.invoke(EXECUTION_READ_CHANNEL),
  startExecution: (value: ExecutionStart): Promise<TaskSummary> => ipcRenderer.invoke(EXECUTION_START_CHANNEL, value),
  stopExecution: (value: ExecutionControl): Promise<void> => ipcRenderer.invoke(EXECUTION_STOP_CHANNEL, value),
  steerExecution: (value: ExecutionSteer): Promise<void> => ipcRenderer.invoke(EXECUTION_STEER_CHANNEL, value),
  answerExecutionApproval: (value: ExecutionApproval): Promise<void> => ipcRenderer.invoke(EXECUTION_APPROVAL_CHANNEL, value),
  onExecutionChanged: (listener: () => void): (() => void) => {
    if (typeof listener !== 'function') throw new Error('执行状态监听器无效');
    const notify = () => listener();
    ipcRenderer.on(EXECUTION_CHANGED_CHANNEL, notify);
    return () => ipcRenderer.removeListener(EXECUTION_CHANGED_CHANNEL, notify);
  },
  renameProject: (value: ProjectRename): Promise<ProjectRecord> => ipcRenderer.invoke(PROJECT_RENAME_CHANNEL, value),
  chooseProject: (value: ProjectOperation): Promise<ProjectChoice> => ipcRenderer.invoke(PROJECT_CHOOSE_CHANNEL, value),
  onWorkspaceChanged: (listener: () => void): (() => void) => {
    if (typeof listener !== 'function') throw new Error('工作区监听器无效');
    const notify = () => listener();
    ipcRenderer.on(WORKSPACE_CHANGED_CHANNEL, notify);
    return () => ipcRenderer.removeListener(WORKSPACE_CHANGED_CHANNEL, notify);
  },
  getWorkspace: (): Promise<WorkspaceSnapshot> => ipcRenderer.invoke(WORKSPACE_READ_CHANNEL),
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
