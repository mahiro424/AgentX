import { dialog, type BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectChoice, ProjectRename, ProjectRecord, ProjectSummary, WorkspaceSnapshot } from '../../shared/contracts/projects';
import { associateProject, readWorkspace, renameProject } from '../storage/projects';

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);

async function directoryStatus(directory: string): Promise<Pick<ProjectSummary, 'directoryState' | 'directoryError'>> {
  try {
    if (await fs.realpath(directory) !== directory) return { directoryState: 'unavailable', directoryError: '目录目标已变化，请核对原目录；不会自动重新关联' };
    if (!(await fs.stat(directory)).isDirectory()) return { directoryState: 'unavailable', directoryError: '原位置已不是文件夹，请检查原目录' };
    const handle = await fs.opendir(directory); await handle.close();
    return { directoryState: 'available', directoryError: null };
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    return { directoryState: 'unavailable', directoryError: code === 'ENOENT' || code === 'ENOTDIR'
      ? '目录不存在，请恢复原目录后重试' : '目录无法读取，请检查访问权限或磁盘连接后重试' };
  }
}

export class ProjectService {
  private choosing = false;
  constructor(private readonly root: string) {}

  async read(): Promise<WorkspaceSnapshot> {
    const records = readWorkspace(this.root);
    return { projects: await Promise.all(records.projects.map(async project => ({ ...project, ...await directoryStatus(project.directory) }))),
      // 落盘的非终态只是旧观测；M1-04 用本实例已核对的引擎事件提供活动投影。
      tasks: records.tasks.map(task => ({ ...task, executionState: ['idle', 'completed', 'failed', 'interrupted', 'unconfirmed'].includes(task.executionState) ? task.executionState : 'reconciling' })),
    };
  }

  rename(request: unknown): ProjectRecord {
    if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).length !== 4 ||
        !('operationId' in request) || !uuid(request.operationId) || !('projectId' in request) || !uuid(request.projectId) ||
        !('expectedRevision' in request) || !Number.isSafeInteger(request.expectedRevision) || Number(request.expectedRevision) < 0 ||
        !('displayName' in request) || typeof request.displayName !== 'string' || !request.displayName.trim() ||
        request.displayName.trim().length > 120 || /[\u0000-\u001f\u007f]/u.test(request.displayName)) throw new Error('项目名称或编辑请求无效，名称需为 1 至 120 个字符');
    const result = renameProject(this.root, { ...request, displayName: request.displayName.trim() } as ProjectRename);
    if (!result) throw new Error('项目记录已变化或不存在，请重新打开编辑；本次输入未保存');
    return result;
  }

  async choose(window: BrowserWindow, request: unknown): Promise<ProjectChoice> {
    if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).length !== 1 ||
        !('operationId' in request) || !uuid(request.operationId)) {
      throw new Error('目录选择请求无效');
    }
    if (this.choosing) throw new Error('正在选择目录，请完成当前选择');
    this.choosing = true;
    try {
      const result = await dialog.showOpenDialog(window, { title: '关联本地项目', buttonLabel: '关联项目', properties: ['openDirectory'] });
      if (result.canceled || !result.filePaths.length) return { status: 'cancelled' };
      if (result.filePaths.length !== 1) throw new Error('每次只能关联一个项目目录');
      let directory: string;
      try {
        directory = await fs.realpath(path.resolve(result.filePaths[0]));
        if (!(await fs.stat(directory)).isDirectory()) throw new Error('not-directory');
        const handle = await fs.opendir(directory);
        await handle.close();
      } catch { throw new Error('所选目录不存在或无法读取，请检查目录及访问权限后重新选择'); }
      return associateProject(this.root, directory);
    } finally { this.choosing = false; }
  }
}
