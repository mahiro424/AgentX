import { validateProcessIdentity, type ProcessIdentity } from '../lifecycle/process-identity';
import { withDatabase } from './database';
import { statSync } from 'node:fs';
import path from 'node:path';

interface RuntimeLeaseInput {
  leaseId: string;
  instanceId: string;
  taskId: string;
  operationId: string;
  projectId: string;
  identity: ProcessIdentity;
  createdAt: string;
}

export interface RuntimeLease extends RuntimeLeaseInput {
  workStarted: boolean;
  rootClosedAt: string | null;
  releasedAt: string | null;
}

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
const time = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

function validateLease(value: RuntimeLeaseInput): void {
  if (!value || ![value.leaseId, value.instanceId, value.taskId, value.operationId, value.projectId].every(uuid) || !time(value.createdAt)) {
    throw new Error('invalid-runtime-lease');
  }
  validateProcessIdentity(value.identity);
}

// 在任何任务派发前保存；此时任务可能尚未落盘，因此只对已存在的项目建立外键。
export function acquireRuntimeLease(root: string, value: RuntimeLeaseInput): void {
  validateLease(value);
  withDatabase(root, database => {
    database.exec('BEGIN IMMEDIATE');
    if (database.prepare('SELECT 1 FROM runtime_leases WHERE released_at IS NULL').get()) throw new Error('runtime-lease-pending');
    database.prepare(`INSERT INTO runtime_leases
      (lease_id,instance_id,task_id,operation_id,project_id,process_identity,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(value.leaseId, value.instanceId, value.taskId, value.operationId, value.projectId, JSON.stringify(value.identity), value.createdAt);
    database.exec('COMMIT');
  });
}

export function readRuntimeLeases(root: string): RuntimeLease[] {
  try { statSync(path.join(root, 'agentx.db')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error('无法核对产品数据库是否存在，不能当作没有引擎归属记录');
  }
  return withDatabase(root, database => database.prepare('SELECT * FROM runtime_leases ORDER BY created_at, lease_id').all().map(row => {
    const value: RuntimeLease = { leaseId: row.lease_id as string, instanceId: row.instance_id as string,
      taskId: row.task_id as string, operationId: row.operation_id as string, projectId: row.project_id as string,
      identity: JSON.parse(row.process_identity as string), createdAt: row.created_at as string,
      workStarted: row.work_started === 1, rootClosedAt: row.root_closed_at as string | null, releasedAt: row.released_at as string | null };
    validateLease(value);
    if (![0, 1].includes(row.work_started as number) || (value.rootClosedAt !== null && !time(value.rootClosedAt)) ||
        (value.releasedAt !== null && (!time(value.releasedAt) || value.rootClosedAt === null))) throw new Error('invalid-runtime-reclamation');
    return value;
  }));
}

// 仅表示之后可能发出任务，不代替 execution_intents 中的实际发送/应答证据。
export function markRuntimeWorkStarted(root: string, leaseId: string, instanceId: string): void {
  if (!uuid(leaseId) || !uuid(instanceId)) throw new Error('invalid-runtime-owner');
  withDatabase(root, database => {
    const result = database.prepare(`UPDATE runtime_leases SET work_started=1
      WHERE lease_id=? AND instance_id=? AND work_started=0 AND root_closed_at IS NULL AND released_at IS NULL`).run(leaseId, instanceId);
    if (result.changes !== 1) throw new Error('invalid-runtime-transition');
  });
}

// 必须先等待拥有的 ChildProcess.close；裸关闭只记根进程退出，不能冒称后台已清空。
export function recordRuntimeClosed(root: string, leaseId: string, instanceId: string, backgroundVerified: boolean): void {
  if (!uuid(leaseId) || !uuid(instanceId) || typeof backgroundVerified !== 'boolean') throw new Error('invalid-runtime-owner');
  withDatabase(root, database => {
    const now = new Date().toISOString();
    const result = database.prepare(`UPDATE runtime_leases SET root_closed_at=COALESCE(root_closed_at,?),
      released_at=CASE WHEN work_started=0 OR ?=1 THEN COALESCE(released_at,?) ELSE released_at END
      WHERE lease_id=? AND instance_id=?`).run(now, backgroundVerified ? 1 : 0, now, leaseId, instanceId);
    if (result.changes !== 1) throw new Error('invalid-runtime-transition');
  });
}
