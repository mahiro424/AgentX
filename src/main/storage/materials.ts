import type { DatabaseSync } from 'node:sqlite';
import type { MaterialRecord, FrozenMaterialInput } from '../../shared/contracts/materials';
import { MATERIAL_LIMITS } from '../../shared/contracts/materials';
import { withDatabase } from './database';

export function materialIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MATERIAL_LIMITS.count || value.some(id => typeof id !== 'string' ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) || new Set(value).size !== value.length) throw new Error('材料引用无效或超过 16 项');
  return value;
}

export function readMaterialsIn(database: DatabaseSync, input: unknown): MaterialRecord[] {
  return materialIds(input).map(id => {
    const row = database.prepare('SELECT record FROM materials WHERE material_id=?').get(id);
    if (!row || typeof row.record !== 'string' || row.record.length > 32768) throw new Error('invalid-material-reference');
    const record = JSON.parse(row.record) as MaterialRecord;
    if (record.materialId !== id || typeof record.path !== 'string' || typeof record.name !== 'string' ||
      !['text', 'directory', 'image', 'spreadsheet', 'unsupported'].includes(record.kind) ||
      !['ready', 'changed', 'missing', 'unreadable', 'unsupported', 'blockedImage'].includes(record.status) ||
      typeof record.message !== 'string' || (record.version !== null && (typeof record.version.identity !== 'string' ||
        !Number.isSafeInteger(record.version.size) || record.version.size < 0 ||
        (record.version.sha256 !== null && !/^[a-f0-9]{64}$/.test(record.version.sha256))))) throw new Error('invalid-material-record');
    return record;
  });
}

export function readMaterials(root: string, ids: unknown): MaterialRecord[] {
  const selected = materialIds(ids);
  return selected.length ? withDatabase(root, db => readMaterialsIn(db, selected)) : [];
}

export function storeMaterial(root: string, value: MaterialRecord): MaterialRecord {
  return withDatabase(root, db => {
    // 每次显式重查产生不可变版本；重复选择同一身份和字节则复用原引用。
    const content = JSON.stringify({ ...value, materialId: '' });
    const previous = db.prepare("SELECT material_id FROM materials WHERE json_remove(record, '$.materialId')=json_remove(?, '$.materialId') LIMIT 1").get(content);
    if (previous) return readMaterialsIn(db, [previous.material_id])[0];
    db.prepare('INSERT INTO materials(material_id,record) VALUES (?,?)').run(value.materialId, JSON.stringify(value));
    return value;
  });
}

export function bindInputMaterials(database: DatabaseSync, taskId: string, operationId: string, input: FrozenMaterialInput | undefined,
  kind: 'turn' | 'steer' = 'turn', turnId: string | null = null): void {
  if (!input?.records.length) return;
  const ids = materialIds(input.records.map(record => record.materialId));
  if (!Number.isSafeInteger(input.revision) || input.revision < 0 ||
    JSON.stringify(readMaterialsIn(database, ids)) !== JSON.stringify(input.records)) throw new Error('invalid-frozen-materials');
  database.prepare('INSERT INTO input_materials(operation_id,task_id,turn_id,draft_revision,material_ids,kind) VALUES (?,?,?,?,?,?)')
    .run(operationId, taskId, turnId, input.revision, JSON.stringify(ids), kind);
}

export function readInputMaterials(root: string, taskId: string) {
  return withDatabase(root, db => db.prepare('SELECT * FROM input_materials WHERE task_id=? ORDER BY rowid').all(taskId).map(row => {
    if (typeof row.material_ids !== 'string' || row.material_ids.length > 1024 || !Number.isSafeInteger(row.draft_revision)) throw new Error('invalid-input-materials');
    return { operationId: row.operation_id as string, turnId: row.turn_id as string | null, revision: row.draft_revision as number,
      kind: row.kind as 'turn' | 'steer', acknowledged: row.acknowledged === 1, materials: readMaterialsIn(db, JSON.parse(row.material_ids)) };
  }));
}

export function tasksWithMaterialInputs(root: string): Set<string> {
  return withDatabase(root, db => new Set(db.prepare('SELECT DISTINCT task_id FROM input_materials').all().map(row => row.task_id as string)));
}
