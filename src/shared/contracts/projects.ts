export const WORKSPACE_READ_CHANNEL = 'agentx:workspace-read';
export const PROJECT_CHOOSE_CHANNEL = 'agentx:project-choose';
export const WORKSPACE_CHANGED_CHANNEL = 'agentx:workspace-changed';
export const PROJECT_RENAME_CHANNEL = 'agentx:project-rename';
export const TASK_RENAME_CHANNEL = 'agentx:task-rename';
export const TASK_PIN_CHANNEL = 'agentx:task-pin';
export const TASK_ARCHIVE_CHANNEL = 'agentx:task-archive';

export interface ProjectOperation { operationId: string }
export interface ProjectRename extends ProjectOperation { projectId: string; displayName: string; expectedRevision: number }
export interface TaskRename extends ProjectOperation { taskId: string; title: string; expectedRevision: number }
export interface TaskPin extends ProjectOperation { taskId: string; pinned: boolean; expectedRevision: number }
export interface TaskArchive extends ProjectOperation { taskId: string; archived: boolean; expectedRevision: number }
export type ProjectChoice = { status: 'cancelled' } | { status: 'associated' | 'duplicate'; project: ProjectRecord };

export interface ProjectRecord {
  projectId: string;
  displayName: string;
  directory: string;
  createdAt: string;
  revision: number;
}

export interface ProjectSummary extends ProjectRecord {
  directoryState: 'available' | 'unavailable';
  directoryError: string | null;
}

export interface WorkspaceSnapshot {
  projects: ProjectSummary[];
  tasks: OrganizedTaskSummary[];
}

export const EXECUTION_STATES = ['idle', 'submitting', 'running', 'waitingApproval', 'waitingInput', 'stopping', 'reconciling', 'unconfirmed', 'completed', 'failed', 'interrupted'] as const;
export type ExecutionState = typeof EXECUTION_STATES[number];
export interface TaskSummary {
  taskId: string;
  projectId: string | null;
  title: string;
  directory: string;
  lastActivityAt: string;
  observedAt: string;
  executionState: ExecutionState;
  threadId: string | null;
  turnId: string | null;
}

// 组织修订由产品维护，不进入引擎执行快照的并发控制。
export interface OrganizedTaskSummary extends TaskSummary { organizationRevision: number; pinnedAt: string | null; archivedAt: string | null }
