import type { TaskHistory, HistoryTurn } from './history';

export const RECONCILIATION_READ_CHANNEL = 'agentx:reconciliation-read';
export interface ReconciliationRequest { taskId: string }
export interface ReconciliationIntent {
  operationId: string;
  phase: 'prepared' | 'sent' | 'acknowledged' | 'unknown' | 'settled';
  turnId: string | null;
  createdAt: string;
}
export interface ReconciliationSnapshot {
  taskId: string;
  title: string;
  observedAt: string;
  stale: boolean;
  intents: ReconciliationIntent[];
  processes: {
    leaseId: string;
    operationId: string;
    state: 'sameProcess' | 'notFound' | 'pidReused' | 'released' | 'unavailable';
    background: 'released' | 'unverified';
    rootClosedAt: string | null;
    error: string | null;
  }[];
  history: TaskHistory | null;
  historyError: string | null;
  matchedTurnStatus: HistoryTurn['status'] | null;
  bindingIssue: string | null;
}
