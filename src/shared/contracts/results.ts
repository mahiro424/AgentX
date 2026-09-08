export const TASK_RESULTS_READ_CHANNEL = 'agentx:task-results-read';
export interface TaskResultsRequest { taskId: string; turnId: string }
export interface ResultFile { path: string; sha256: string; size: number; text: string | null }
export interface ResultChange { path: string; operation: 'add' | 'update' | 'delete'; before: ResultFile | null; after: ResultFile | null }
export type ResultGitState = { status: 'available'; changes: { path: string; index: string; worktree: string }[] }
  | { status: 'notRepository' | 'unavailable'; message: string };
export interface TaskResults extends TaskResultsRequest {
  threadId: string;
  operationId: string;
  directory: string;
  executionState: 'completed' | 'failed' | 'interrupted';
  baselineAt: string;
  observedAt: string;
  complete: boolean;
  changes: ResultChange[];
  issues: { path: string; reason: 'unreadable' | 'link' | 'limit' | 'changedDuringRead'; code?: string }[];
  excludedNames: string[];
  baselineGit: ResultGitState;
}
