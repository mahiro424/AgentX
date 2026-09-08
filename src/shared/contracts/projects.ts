export const WORKSPACE_READ_CHANNEL = 'agentx:workspace-read';
export const PROJECT_CHOOSE_CHANNEL = 'agentx:project-choose';
export const WORKSPACE_CHANGED_CHANNEL = 'agentx:workspace-changed';
export const PROJECT_RENAME_CHANNEL = 'agentx:project-rename';

export interface ProjectOperation { operationId: string }
export interface ProjectRename extends ProjectOperation { projectId: string; displayName: string; expectedRevision: number }
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
  tasks: TaskSummary[];
}

export const EXECUTION_STATES = ['idle', 'submitting', 'running', 'waitingApproval', 'waitingInput', 'stopping', 'reconciling', 'unconfirmed', 'completed', 'failed', 'interrupted'] as const;
export type ExecutionState = typeof EXECUTION_STATES[number];
export interface TaskSummary {
  taskId: string;
  projectId: string;
  title: string;
  directory: string;
  lastActivityAt: string;
  observedAt: string;
  executionState: ExecutionState;
  threadId: string | null;
  turnId: string | null;
}
