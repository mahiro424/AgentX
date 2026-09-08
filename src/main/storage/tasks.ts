import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { EXECUTION_STATES, type TaskSummary, type OrganizedTaskSummary, type TaskRename } from '../../shared/contracts/projects';
import { withDatabase } from './database';
import { FLASH_MODEL_ID } from '../../shared/contracts/models';
import type { ReconciliationIntent } from '../../shared/contracts/reconciliation';

interface SubmissionInput {
  operationId: string;
  text: string;
  modelId: string;
  configRevision: number;
  credentialRef: string;
}

function validateSubmission(value: SubmissionInput): void {
  const uuid = (text: unknown) => typeof text === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(text);
  if (!value || !uuid(value.operationId) || !uuid(value.credentialRef) || value.modelId !== FLASH_MODEL_ID ||
      !Number.isSafeInteger(value.configRevision) || value.configRevision < 0 || typeof value.text !== 'string' ||
      !value.text.trim() || value.text.length > 200000 || value.text.includes('\0')) throw new Error('invalid-submission-intent');
}

function validateTask(value: TaskSummary): TaskSummary {
  const text = (field: unknown, limit: number) => typeof field === 'string' && field.trim().length > 0 && field.length <= limit && !/[\u0000-\u001f\u007f]/u.test(field);
  const time = (field: unknown) => typeof field === 'string' && Number.isFinite(Date.parse(field)) && new Date(field).toISOString() === field;
  if (!text(value.taskId, 128) || !text(value.projectId, 128) || !text(value.title, 500) || !text(value.directory, 32767) || !path.isAbsolute(value.directory) ||
      !time(value.lastActivityAt) || !time(value.observedAt) || !EXECUTION_STATES.includes(value.executionState) ||
      (value.threadId !== null && !text(value.threadId, 512)) || (value.turnId !== null && (!value.threadId || !text(value.turnId, 512)))) throw new Error('invalid-task-record');
  return value;
}

// 由 Main 执行协调模块保存产品记录；不向 Renderer 暴露造会话或改执行状态的接口。
export function createTaskRecord(root: string, value: TaskSummary): void {
  validateTask(value);
  withDatabase(root, database => insertTask(database, value));
}

function insertTask(database: DatabaseSync, value: TaskSummary): void {
  const project = database.prepare('SELECT directory FROM projects WHERE project_id=?').get(value.projectId);
  if (!project || project.directory !== value.directory) throw new Error('invalid-project-binding');
  database.prepare(`INSERT INTO tasks (task_id,project_id,title,directory,created_at,last_activity_at,observed_at,execution_state,thread_id,turn_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(value.taskId, value.projectId, value.title,
    value.directory, value.lastActivityAt, value.lastActivityAt, value.observedAt, value.executionState, value.threadId, value.turnId);
}

export function beginTaskSubmission(root: string, task: TaskSummary, intent: SubmissionInput): void {
  validateTask(task); validateSubmission(intent);
  if (task.executionState !== 'submitting' || task.threadId !== null || task.turnId !== null) throw new Error('invalid-first-submission');
  withDatabase(root, database => {
    database.exec('BEGIN IMMEDIATE');
    insertTask(database, task);
    // 显式列出产品元数据；即使调用者带了内部凭据快照，也不序列化其中的明文 Key。
    database.prepare(`INSERT INTO execution_intents
      (operation_id,task_id,input_text,model_id,config_revision,credential_ref,created_at,phase) VALUES (?,?,?,?,?,?,?,'prepared')`)
      .run(intent.operationId, task.taskId, intent.text, intent.modelId, intent.configRevision, intent.credentialRef, task.lastActivityAt);
    database.exec('COMMIT');
  });
}

export function readSubmissionIntent(root: string, operationId: string) {
  return withDatabase(root, database => {
    const row = database.prepare('SELECT * FROM execution_intents WHERE operation_id=?').get(operationId);
    if (!row) return null;
    const value = { operationId: row.operation_id as string, taskId: row.task_id as string, text: row.input_text as string,
      modelId: row.model_id as string, configRevision: row.config_revision as number, credentialRef: row.credential_ref as string, phase: row.phase as string };
    validateSubmission(value);
    if (!['prepared', 'sent', 'acknowledged', 'unknown', 'settled'].includes(value.phase) ||
        !database.prepare('SELECT 1 FROM tasks WHERE task_id=?').get(value.taskId)) throw new Error('invalid-submission-binding');
    return value;
  });
}

// 必须在 RPC 写入之前调用；落盘后即使写入应答丢失，也不能把该意图当作未发送重试。
export function markSubmissionDispatched(root: string, taskId: string, operationId: string): void {
  withDatabase(root, database => {
    const result = database.prepare(`UPDATE execution_intents SET phase='sent'
      WHERE operation_id=? AND task_id=? AND phase='prepared'
      AND EXISTS (SELECT 1 FROM tasks WHERE task_id=? AND execution_state='submitting')`)
      .run(operationId, taskId, taskId);
    if (result.changes !== 1) throw new Error('invalid-submission-transition');
  });
}

export function markSubmissionUncertain(root: string, taskId: string, operationId: string, observedAt: string): void {
  if (typeof observedAt !== 'string' || !Number.isFinite(Date.parse(observedAt)) || new Date(observedAt).toISOString() !== observedAt) {
    throw new Error('invalid-observation-time');
  }
  withDatabase(root, database => {
    database.exec('BEGIN IMMEDIATE');
    const intent = database.prepare(`UPDATE execution_intents SET phase='unknown'
      WHERE operation_id=? AND task_id=? AND phase IN ('sent','acknowledged')`).run(operationId, taskId);
    if (intent.changes !== 1) throw new Error('invalid-submission-transition');
    const task = database.prepare(`UPDATE tasks SET execution_state='reconciling', observed_at=?
      WHERE task_id=? AND execution_state IN ('submitting','running','waitingApproval','waitingInput','stopping') AND observed_at<=?`).run(observedAt, taskId, observedAt);
    if (task.changes !== 1) throw new Error('invalid-task-transition');
    database.exec('COMMIT');
  });
}

export function bindSubmissionThread(root: string, taskId: string, operationId: string, threadId: string): void {
  if (typeof threadId !== 'string' || !threadId.trim() || threadId.length > 512 || /[\u0000-\u001f\u007f]/u.test(threadId)) throw new Error('invalid-thread-id');
  withDatabase(root, database => {
    const result = database.prepare(`UPDATE tasks SET thread_id=? WHERE task_id=? AND thread_id IS NULL
      AND turn_id IS NULL AND execution_state='submitting'
      AND EXISTS (SELECT 1 FROM execution_intents WHERE operation_id=? AND task_id=? AND phase='sent')`)
      .run(threadId, taskId, operationId, taskId);
    if (result.changes !== 1) throw new Error('invalid-thread-binding');
  });
}

export function acknowledgeSubmission(root: string, taskId: string, operationId: string, threadId: string, turnId: string): void {
  if (typeof turnId !== 'string' || !turnId.trim() || turnId.length > 512 || /[\u0000-\u001f\u007f]/u.test(turnId)) throw new Error('invalid-turn-id');
  withDatabase(root, database => {
    database.exec('BEGIN IMMEDIATE');
    const task = database.prepare(`UPDATE tasks SET turn_id=?, execution_state='running'
      WHERE task_id=? AND thread_id=? AND turn_id IS NULL AND execution_state='submitting'`).run(turnId, taskId, threadId);
    if (task.changes !== 1) throw new Error('invalid-turn-binding');
    const intent = database.prepare(`UPDATE execution_intents SET phase='acknowledged', turn_id=?
      WHERE operation_id=? AND task_id=? AND phase='sent' AND turn_id IS NULL`).run(turnId, operationId, taskId);
    if (intent.changes !== 1) throw new Error('invalid-submission-transition');
    database.exec('COMMIT');
  });
}

export function readTaskRecords(database: DatabaseSync): TaskSummary[] {
  return database.prepare('SELECT * FROM tasks ORDER BY last_activity_at DESC, task_id').all().map(taskFromRow);
}

function taskFromRow(row: Record<string, unknown>): TaskSummary {
  return validateTask({
    taskId: row.task_id as string, projectId: row.project_id as string, title: row.title as string, directory: row.directory as string,
    lastActivityAt: row.last_activity_at as string, observedAt: row.observed_at as string, executionState: row.execution_state as TaskSummary['executionState'],
    threadId: row.thread_id as string | null, turnId: row.turn_id as string | null,
  });
}

export function readTaskSubmissionIntents(root: string, taskId: string): ReconciliationIntent[] {
  return withDatabase(root, database => database.prepare('SELECT * FROM execution_intents WHERE task_id=? ORDER BY created_at, operation_id').all(taskId).map(row => {
    validateSubmission({ operationId: row.operation_id as string, text: row.input_text as string, modelId: row.model_id as string,
      configRevision: row.config_revision as number, credentialRef: row.credential_ref as string });
    const value: ReconciliationIntent = { operationId: row.operation_id as string, phase: row.phase as ReconciliationIntent['phase'],
      turnId: row.turn_id as string | null, createdAt: row.created_at as string };
    if (!['prepared', 'sent', 'acknowledged', 'unknown', 'settled'].includes(value.phase) ||
        !Number.isFinite(Date.parse(value.createdAt)) || new Date(value.createdAt).toISOString() !== value.createdAt ||
        (value.turnId !== null && (typeof value.turnId !== 'string' || !value.turnId.trim() || value.turnId.length > 512 || /[\u0000-\u001f\u007f]/u.test(value.turnId)))) {
      throw new Error('invalid-submission-reconciliation');
    }
    return value;
  }));
}

function organizedTaskFromRow(row: Record<string, unknown>): OrganizedTaskSummary {
  if (typeof row.organization_revision !== 'number' || !Number.isSafeInteger(row.organization_revision) || row.organization_revision < 0) {
    throw new Error('invalid-task-organization-revision');
  }
  return { ...taskFromRow(row), organizationRevision: row.organization_revision };
}

export function readOrganizedTaskRecords(database: DatabaseSync): OrganizedTaskSummary[] {
  return database.prepare('SELECT * FROM tasks ORDER BY last_activity_at DESC, task_id').all().map(organizedTaskFromRow);
}

export function renameTask(root: string, request: TaskRename): OrganizedTaskSummary | null {
  return withDatabase(root, database => {
    database.exec('BEGIN IMMEDIATE');
    const row = database.prepare(`UPDATE tasks SET title=?, organization_revision=organization_revision+1
      WHERE task_id=? AND organization_revision=? RETURNING *`).get(request.title, request.taskId, request.expectedRevision);
    const value = row ? organizedTaskFromRow(row) : null;
    database.exec('COMMIT');
    return value;
  });
}

export function beginTaskContinuation(root: string, previous: TaskSummary, intent: SubmissionInput): void {
  validateTask(previous); validateSubmission(intent);
  if (!previous.threadId || !previous.turnId || !['completed', 'failed', 'interrupted'].includes(previous.executionState)) throw new Error('invalid-continuation');
  const now = new Date(Math.max(Date.now(), Date.parse(previous.observedAt))).toISOString();
  withDatabase(root, database => {
    database.exec('BEGIN IMMEDIATE');
    const task = database.prepare(`UPDATE tasks SET execution_state='submitting', turn_id=NULL, observed_at=?, last_activity_at=?
      WHERE task_id=? AND thread_id=? AND turn_id=? AND execution_state=? AND project_id=? AND directory=?
      AND NOT EXISTS (SELECT 1 FROM execution_intents WHERE task_id=? AND phase<>'settled')`)
      .run(now, now, previous.taskId, previous.threadId, previous.turnId, previous.executionState, previous.projectId, previous.directory, previous.taskId);
    if (task.changes !== 1) throw new Error('invalid-continuation-binding');
    database.prepare(`INSERT INTO execution_intents
      (operation_id,task_id,input_text,model_id,config_revision,credential_ref,created_at,phase) VALUES (?,?,?,?,?,?,?,'prepared')`)
      .run(intent.operationId, previous.taskId, intent.text, intent.modelId, intent.configRevision, intent.credentialRef, now);
    database.exec('COMMIT');
  });
}

// 不按“最新时间”猜测轮次归属；老版本缺失绑定的记录保持未知。
export function readTurnOperation(root: string, taskId: string, turnId: string): string | null {
  return withDatabase(root, database => {
    const row = database.prepare('SELECT operation_id FROM execution_intents WHERE task_id=? AND turn_id=?').get(taskId, turnId);
    return row ? row.operation_id as string : null;
  });
}

export function settleTaskTurn(root: string, taskId: string, operationId: string, threadId: string, turnId: string,
  state: 'completed' | 'failed' | 'interrupted'): boolean {
  if (!['completed', 'failed', 'interrupted'].includes(state)) throw new Error('invalid-terminal-state');
  return withDatabase(root, database => {
    database.exec('BEGIN IMMEDIATE');
    const bound = database.prepare(`SELECT observed_at FROM tasks WHERE task_id=? AND thread_id=? AND turn_id=?
      AND execution_state IN ('running','waitingApproval','waitingInput','stopping','reconciling')
      AND EXISTS (SELECT 1 FROM execution_intents WHERE operation_id=? AND task_id=? AND phase IN ('acknowledged','unknown'))`)
      .get(taskId, threadId, turnId, operationId, taskId);
    if (!bound) { database.exec('COMMIT'); return false; }
    const observed = Date.parse(bound.observed_at as string);
    if (!Number.isFinite(observed)) throw new Error('invalid-task-observation');
    const now = new Date(Math.max(Date.now(), observed)).toISOString();
    database.prepare('UPDATE tasks SET execution_state=?, observed_at=?, last_activity_at=? WHERE task_id=?').run(state, now, now, taskId);
    database.prepare("UPDATE execution_intents SET phase='settled' WHERE operation_id=? AND task_id=?").run(operationId, taskId);
    database.exec('COMMIT');
    return true;
  });
}

export function beginTaskStop(root: string, taskId: string, operationId: string, threadId: string, turnId: string): void {
  withDatabase(root, database => {
    const result = database.prepare(`UPDATE tasks SET execution_state='stopping'
      WHERE task_id=? AND thread_id=? AND turn_id=? AND execution_state IN ('running','waitingApproval','waitingInput')
      AND EXISTS (SELECT 1 FROM execution_intents WHERE operation_id=? AND task_id=? AND phase='acknowledged')`)
      .run(taskId, threadId, turnId, operationId, taskId);
    if (result.changes !== 1) throw new Error('invalid-stop-transition');
  });
}

export function updateApprovalWait(root: string, taskId: string, operationId: string, threadId: string, turnId: string, waiting: boolean): void {
  withDatabase(root, database => {
    database.prepare(`UPDATE tasks SET execution_state=? WHERE task_id=? AND thread_id=? AND turn_id=?
      AND execution_state IN ('running','waitingApproval')
      AND EXISTS (SELECT 1 FROM execution_intents WHERE operation_id=? AND task_id=? AND phase='acknowledged')`)
      .run(waiting ? 'waitingApproval' : 'running', taskId, threadId, turnId, operationId, taskId);
  });
}
