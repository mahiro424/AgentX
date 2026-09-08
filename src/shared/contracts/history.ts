import type { ExecutionItem } from './execution';

export const TASK_HISTORY_READ_CHANNEL = 'agentx:task-history-read';
export interface TaskHistoryRequest { taskId: string }
export type HistoryItem = ExecutionItem | { kind: 'userMessage'; threadId: string; turnId: string; itemId: string; text: string };
export interface HistoryTurn {
  turnId: string;
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
  items: HistoryItem[];
  unrepresentedItemTypes: string[];
}
export interface TaskHistory { taskId: string; threadId: string; turns: HistoryTurn[] }
