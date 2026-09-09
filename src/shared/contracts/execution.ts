import type { TaskSummary } from './projects';

export const EXECUTION_READ_CHANNEL = 'agentx:execution-read';
export const EXECUTION_START_CHANNEL = 'agentx:execution-start';
export const EXECUTION_CONTINUE_CHANNEL = 'agentx:execution-continue';
export const EXECUTION_STOP_CHANNEL = 'agentx:execution-stop';
export const EXECUTION_STEER_CHANNEL = 'agentx:execution-steer';
export const EXECUTION_APPROVAL_CHANNEL = 'agentx:execution-approval';
export const EXECUTION_CHANGED_CHANNEL = 'agentx:execution-changed';

export interface ExecutionStart {
  taskId: string;
  operationId: string;
  projectId: string | null;
  text: string;
  modelId: string;
  configRevision: number;
}

export interface ExecutionControl {
  taskId: string;
  operationId: string;
  threadId: string;
  turnId: string;
}

export interface ExecutionContinue extends ExecutionStart { threadId: string; expectedTurnId: string }

export interface ExecutionSteer extends ExecutionControl { text: string }
export interface ExecutionApproval extends ExecutionControl { approvalToken: string; decision: 'accept' | 'decline' }

export interface ApprovalItem {
  approvalToken: string;
  kind: 'command' | 'writeStdin' | 'fileChange';
  threadId: string;
  turnId: string;
  itemId: string;
  startedAtMs: number;
  command: string | null;
  cwd: string | null;
  reason: string | null;
  environmentId: string | null;
  network: { host: string; protocol: string } | null;
  grantRoot: string | null;
  status: 'pending' | 'responding' | 'resolved' | 'stale';
}

export interface ExecutionSnapshot {
  reconciliationTaskIds?: string[];
  inputText?: string;
  plan?: ExecutionPlan;
  preparing: boolean;
  task: TaskSummary | null;
  operationId: string | null;
  items: ExecutionItem[];
  approvals: ApprovalItem[];
  error: string | null;
}

export interface ExecutionPlan {
  threadId: string;
  turnId: string;
  explanation: string | null;
  plan: { step: string; status: 'pending' | 'inProgress' | 'completed' }[];
}

export interface MessageItem {
  kind: 'message';
  threadId: string;
  turnId: string;
  itemId: string;
  text: string;
  phase: 'commentary' | 'final_answer' | null;
  status: 'running' | 'completed';
}

export interface CommandItem {
  kind: 'command';
  threadId: string;
  turnId: string;
  itemId: string;
  command: string;
  directory: string;
  output: string | null;
  exitCode: number | null;
  durationMs: number | null;
  status: 'running' | 'completed' | 'failed' | 'declined';
}

export interface FileChangeItem {
  kind: 'fileChange';
  threadId: string;
  turnId: string;
  itemId: string;
  status: 'running' | 'completed' | 'failed' | 'declined';
  changes: { path: string; operation: 'add' | 'delete' | 'update'; movePath: string | null; diff: string }[];
}

export type ExecutionItem = MessageItem | CommandItem | FileChangeItem;
