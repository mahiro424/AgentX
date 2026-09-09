import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ProjectChoice, ProjectRename, ProjectRecord, OrganizedTaskSummary } from '../../shared/contracts/projects';
import { withDatabase } from './database';
import { readOrganizedTaskRecords } from './tasks';

function projectFromRow(row: Record<string, unknown>): ProjectRecord {
  if (typeof row.project_id !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(row.project_id) ||
      typeof row.display_name !== 'string' || !row.display_name.trim() || row.display_name.length > 120 || /[\u0000-\u001f\u007f]/u.test(row.display_name) ||
      typeof row.directory !== 'string' || !path.isAbsolute(row.directory) || row.directory.includes('\0') ||
      typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 0 ||
      typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at)) || new Date(row.created_at).toISOString() !== row.created_at) throw new Error('invalid-project-record');
  return { projectId: row.project_id, displayName: row.display_name, directory: row.directory, createdAt: row.created_at, revision: row.revision };
}

export function readWorkspace(root: string): { projects: ProjectRecord[]; tasks: OrganizedTaskSummary[] } {
  try { fs.lstatSync(path.join(root, 'agentx.db')); }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return { projects: [], tasks: [] };
    throw new Error('产品数据库无法访问，请检查数据目录权限或磁盘连接；不会按空历史处理');
  }
  return withDatabase(root, database => {
    const projects = database.prepare('SELECT * FROM projects ORDER BY created_at, project_id').all().map(projectFromRow);
    const tasks = readOrganizedTaskRecords(database);
    const directories = new Map(projects.map(project => [project.projectId, project.directory]));
    // 无项目任务只认产品分配的持久目录；孤儿或错目录记录不能被列表分组静默藏掉。
    if (tasks.some(task => (task.projectId === null ? path.join(root, 'workspaces', task.taskId) : directories.get(task.projectId)) !== task.directory)) throw new Error('invalid-task-project-binding');
    return { projects, tasks };
  });
}

export function renameProject(root: string, value: ProjectRename): ProjectRecord | null {
  return withDatabase(root, database => {
    database.exec('BEGIN IMMEDIATE');
    const row = database.prepare(`UPDATE projects SET display_name=?, revision=revision+1 WHERE project_id=? AND revision=? RETURNING *`)
      .get(value.displayName, value.projectId, value.expectedRevision);
    const result = row ? projectFromRow(row) : null;
    database.exec('COMMIT');
    return result;
  });
}

export function associateProject(root: string, directory: string): ProjectChoice {
  const project: ProjectRecord = { projectId: randomUUID(), displayName: (path.basename(directory) || directory).slice(0, 120),
    directory, createdAt: new Date().toISOString(), revision: 0 };
  return withDatabase(root, database => {
    // realpath 已解析目录别名；精确比较保留 Windows 区分大小写目录的差异。
    const existing = database.prepare('SELECT * FROM projects WHERE directory=?').get(directory);
    if (existing) return { status: 'duplicate', project: projectFromRow(existing) };
    database.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?)').run(project.projectId, project.displayName,
      project.directory, project.createdAt, project.revision);
    return { status: 'associated', project };
  });
}
