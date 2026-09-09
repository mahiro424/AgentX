import type { DatabaseSync } from 'node:sqlite';
import type { DraftScope, DraftRecord, DraftSave } from '../../shared/contracts/drafts';
import { withDatabase } from './database';
import { existsSync } from 'node:fs';
import path from 'node:path';

function scope(value: unknown, fields: number): DraftScope {
  const validId = (id: unknown) => id === null || (typeof id === 'string' && id.length > 0 && id.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(id));
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields ||
    !('projectId' in value) || !('taskId' in value) || !validId(value.projectId) || !validId(value.taskId)) throw new Error('草稿归属无效');
  return { projectId: value.projectId as string | null, taskId: value.taskId as string | null };
}

function key(database: DatabaseSync, value: DraftScope): string {
  if (value.projectId !== null && !database.prepare('SELECT 1 FROM projects WHERE project_id=?').get(value.projectId)) throw new Error('invalid-draft-project');
  if (value.taskId !== null && !database.prepare('SELECT 1 FROM tasks WHERE task_id=? AND project_id IS ?').get(value.taskId, value.projectId)) throw new Error('invalid-draft-task');
  return JSON.stringify([value.projectId, value.taskId]);
}

function read(database: DatabaseSync, value: DraftScope, scopeKey: string): DraftRecord {
  const row = database.prepare('SELECT input_text,revision FROM drafts WHERE scope_key=?').get(scopeKey);
  if (!row) return { ...value, text: '', revision: 0 };
  if (typeof row.input_text !== 'string' || row.input_text.length > 200000 || row.input_text.includes('\0') ||
    typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error('invalid-draft-record');
  return { ...value, text: row.input_text, revision: row.revision };
}

export function readDraft(root: string, input: unknown): DraftRecord {
  const value = scope(input, 2);
  if (!existsSync(path.join(root, 'agentx.db')) && value.projectId === null && value.taskId === null) return { ...value, text: '', revision: 0 };
  return withDatabase(root, database => read(database, value, key(database, value)));
}

export function saveDraft(root: string, input: unknown): DraftRecord {
  const value = scope(input, 4), request = input as DraftSave;
  if (typeof request.text !== 'string' || request.text.length > 200000 || request.text.includes('\0') ||
    !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0 || request.expectedRevision >= Number.MAX_SAFE_INTEGER) throw new Error('草稿内容或修订无效');
  return withDatabase(root, database => {
    database.exec('BEGIN IMMEDIATE');
    const scopeKey = key(database, value), previous = read(database, value, scopeKey);
    if (previous.revision !== request.expectedRevision) throw new Error('invalid-draft-revision');
    const revision = previous.revision + 1;
    database.prepare(`INSERT INTO drafts(scope_key,project_id,task_id,input_text,revision) VALUES (?,?,?,?,?)
      ON CONFLICT(scope_key) DO UPDATE SET input_text=excluded.input_text, revision=excluded.revision`)
      .run(scopeKey, value.projectId, value.taskId, request.text, revision);
    database.exec('COMMIT');
    return { ...value, text: request.text, revision };
  });
}
