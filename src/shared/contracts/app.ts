import type { ProjectChoice, ProjectOperation, ProjectRename, ProjectRecord, WorkspaceSnapshot, TaskRename, TaskPin, TaskArchive, OrganizedTaskSummary } from './projects';
import type { ExitAnswer, ExitSnapshot } from './lifecycle';
import type { ReconciliationRequest, ReconciliationSnapshot } from './reconciliation';
import type { ExecutionStart, ExecutionContinue, ExecutionControl, ExecutionSnapshot, ExecutionSteer, ExecutionApproval } from './execution';
import type { TaskSummary } from './projects';
import type { TaskHistory, TaskHistoryRequest } from './history';
import type { TaskResults, TaskResultsRequest } from './results';
import type { DraftScope, DraftRecord, DraftSave } from './drafts';
import type { ModelTestRequest, ActiveModelChange, ConnectionChange, KeySubmission, ModelOperation, ModelSelectionChange, ModelSettings } from './models';

export const APP_INFO_CHANNEL = 'agentx:app-info';
export const PREFERENCES_READ_CHANNEL = 'agentx:preferences-read';
export const PREFERENCES_SAVE_CHANNEL = 'agentx:preferences-save';
export const OUTPUT_COPY_CHANNEL = 'agentx:output-copy';

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
  getReconciliation(value: ReconciliationRequest): Promise<ReconciliationSnapshot>;
  getExitState(): Promise<ExitSnapshot>;
  answerExit(value: ExitAnswer): Promise<void>;
  onExitChanged(listener: () => void): () => void;
  copyOutput(text: string): Promise<void>;
  getTaskResults(value: TaskResultsRequest): Promise<TaskResults>;
  getTaskHistory(value: TaskHistoryRequest): Promise<TaskHistory>;
  getDraft(value: DraftScope): Promise<DraftRecord>;
  saveDraft(value: DraftSave): Promise<DraftRecord>;
  getExecution(): Promise<ExecutionSnapshot>;
  startExecution(value: ExecutionStart): Promise<TaskSummary>;
  continueExecution(value: ExecutionContinue): Promise<TaskSummary>;
  stopExecution(value: ExecutionControl): Promise<void>;
  steerExecution(value: ExecutionSteer): Promise<void>;
  answerExecutionApproval(value: ExecutionApproval): Promise<void>;
  onExecutionChanged(listener: () => void): () => void;
  renameProject(value: ProjectRename): Promise<ProjectRecord>;
  setTaskPinned(value: TaskPin): Promise<OrganizedTaskSummary>;
  setTaskArchived(value: TaskArchive): Promise<OrganizedTaskSummary>;
  renameTask(value: TaskRename): Promise<OrganizedTaskSummary>;
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
