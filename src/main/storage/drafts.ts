import type { DatabaseSync } from 'node:sqlite';
import type { DraftScope, DraftRecord, DraftSave } from '../../shared/contracts/drafts';
import { withDatabase } from './database';
import { materialIds, readMaterialsIn } from './materials';
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
  const row = database.prepare('SELECT input_text,revision,material_ids FROM drafts WHERE scope_key=?').get(scopeKey);
  if (!row) {
    // 首发后尚未编辑的任务从不可变输入引用恢复材料；已有草稿（包括显式移除）始终优先。
    const source = value.taskId ? database.prepare("SELECT material_ids FROM input_materials WHERE task_id=? AND kind='turn' ORDER BY rowid DESC LIMIT 1").get(value.taskId) : undefined;
    if (source && (typeof source.material_ids !== 'string' || source.material_ids.length > 1024)) throw new Error('invalid-input-materials');
    return { ...value, text: '', revision: 0, materials: source ? readMaterialsIn(database, JSON.parse(source.material_ids as string)) : [] };
  }
  if (typeof row.input_text !== 'string' || row.input_text.length > 200000 || row.input_text.includes('\0') ||
    typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error('invalid-draft-record');
  if (typeof row.material_ids !== 'string' || row.material_ids.length > 1024) throw new Error('invalid-draft-materials');
  return { ...value, text: row.input_text, revision: row.revision, materials: readMaterialsIn(database, JSON.parse(row.material_ids)) };
}

export function readDraft(root: string, input: unknown): DraftRecord {
  const value = scope(input, 2);
  if (!existsSync(path.join(root, 'agentx.db')) && value.projectId === null && value.taskId === null) return { ...value, text: '', revision: 0, materials: [] };
  return withDatabase(root, database => read(database, value, key(database, value)));
}

export function saveDraft(root: string, input: unknown): DraftRecord {
  const hasMaterials = !!input && typeof input === 'object' && 'materialIds' in input;
  const value = scope(input, hasMaterials ? 5 : 4), request = input as DraftSave;
  const ids = hasMaterials ? materialIds(request.materialIds) : null;
  if (typeof request.text !== 'string' || request.text.length > 200000 || request.text.includes('\0') ||
    !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0 || request.expectedRevision >= Number.MAX_SAFE_INTEGER) throw new Error('草稿内容或修订无效');
  return withDatabase(root, database => {
    database.exec('BEGIN IMMEDIATE');
    const scopeKey = key(database, value), previous = read(database, value, scopeKey);
    if (previous.revision !== request.expectedRevision) throw new Error('invalid-draft-revision');
    const materials = ids === null ? previous.materials : readMaterialsIn(database, ids);
    if (new Set(materials.map(material => material.path)).size !== materials.length) throw new Error('invalid-duplicate-material');
    const revision = previous.revision + 1;
    database.prepare(`INSERT INTO drafts(scope_key,project_id,task_id,input_text,revision,material_ids) VALUES (?,?,?,?,?,?)
      ON CONFLICT(scope_key) DO UPDATE SET input_text=excluded.input_text, revision=excluded.revision, material_ids=excluded.material_ids`)
      .run(scopeKey, value.projectId, value.taskId, request.text, revision, JSON.stringify(materials.map(material => material.materialId)));
    database.exec('COMMIT');
    return { ...value, text: request.text, revision, materials };
  });
}
