import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { EXECUTION_STATES, type TaskSummary } from '../../shared/contracts/projects';
import { withDatabase } from './database';

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
  withDatabase(root, database => {
    const project = database.prepare('SELECT directory FROM projects WHERE project_id=?').get(value.projectId);
    if (!project || project.directory !== value.directory) throw new Error('invalid-project-binding');
    database.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(value.taskId, value.projectId, value.title,
      value.directory, value.lastActivityAt, value.lastActivityAt, value.observedAt, value.executionState, value.threadId, value.turnId);
  });
}

export function readTaskRecords(database: DatabaseSync): TaskSummary[] {
  return database.prepare('SELECT * FROM tasks ORDER BY last_activity_at DESC, task_id').all().map(row => validateTask({
    taskId: row.task_id as string, projectId: row.project_id as string, title: row.title as string, directory: row.directory as string,
    lastActivityAt: row.last_activity_at as string, observedAt: row.observed_at as string, executionState: row.execution_state as TaskSummary['executionState'],
    threadId: row.thread_id as string | null, turnId: row.turn_id as string | null,
  }));
}
