import type { FilePreview, MaterialPreviewSource, ResultPreviewSource } from '../../shared/contracts/file-preview';
import { readDraft } from '../storage/drafts';
import { readInputMaterials } from '../storage/materials';
import { MaterialService, inspectMaterialFile } from './materials';
import { readTaskArtifact } from './task-results';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function readFilePreview(root: string, input: unknown): Promise<FilePreview> {
  if (input && typeof input === 'object' && !Array.isArray(input) && 'kind' in input && input.kind === 'result') {
    if (Object.keys(input).length !== 3 || !('taskId' in input) || typeof input.taskId !== 'string' ||
      !('resultId' in input) || typeof input.resultId !== 'string') throw new Error('文件预览请求无效');
    const source = input as ResultPreviewSource, artifact = await readTaskArtifact(root, source.taskId, source.resultId);
    const filename = path.join(artifact.directory, artifact.path), version = { sha256: artifact.sha256, size: artifact.size };
    const base = { source, name: path.basename(filename), path: filename, taskId: artifact.taskId, turnId: artifact.turnId,
      operationId: artifact.operationId, version, currentVersion: null, text: null, spreadsheet: null, document: null, observedAt: new Date().toISOString() };
    try {
      if (await fs.realpath(filename) !== filename || (await fs.lstat(filename)).isSymbolicLink()) return { ...base, status: 'changed', message: '产物路径已变化，未读取替代位置' };
    } catch (cause) {
      const missing = ['ENOENT', 'ENOTDIR'].includes((cause as NodeJS.ErrnoException).code ?? '');
      return { ...base, status: missing ? 'missing' : 'unreadable', message: missing ? '产物已移动或删除，来源引用保留' : '产物无法读取，请核对权限或磁盘连接' };
    }
    const current = await inspectMaterialFile(filename), { record } = current;
    if (record.path !== filename || record.status !== 'ready' || record.version?.sha256 !== version.sha256 || record.version.size !== version.size) {
      return { ...base, currentVersion: record.version, status: record.status === 'ready' ? 'changed' : record.status,
        message: record.status === 'ready' ? '产物内容已变化；此标签仍关联原观察版本，请重新检查文件改动以查看新版本' : record.message };
    }
    return { ...base, currentVersion: record.version, status: 'ready', text: current.text, spreadsheet: current.spreadsheet, document: current.document,
      message: current.spreadsheet ? '实际表格与已登记版本一致；公式未重算，业务数值需核对' : current.document ? '实际文档与已登记版本一致；内容与业务结果仍需核对' : '实际文本与已登记版本一致；变化不全部归因于 Agent' };
  }
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 3 ||
    !('kind' in input) || input.kind !== 'material' || !('scope' in input) || !('materialId' in input) || typeof input.materialId !== 'string') throw new Error('文件预览请求无效');
  const source = input as MaterialPreviewSource;
  const draft = readDraft(root, source.scope);
  const prior = draft.taskId ? readInputMaterials(root, draft.taskId).filter(value => value.materials.some(item => item.materialId === source.materialId)).at(-1) : undefined;
  if (!draft.materials.some(item => item.materialId === source.materialId) && !prior) throw new Error('材料未关联当前草稿或会话，不能读取');
  const observed = await new MaterialService(root).preview(source.materialId);
  const { material } = observed;
  const unsupported = material.status === 'ready' && !['text', 'spreadsheet', 'document'].includes(material.kind);
  return { source, name: material.name, path: material.path, status: unsupported ? 'unsupported' : material.status,
    message: unsupported ? '此对象不提供文本预览；目录引用不会自动展开' : material.status === 'ready' ? '只读内容；不执行脚本或重算公式' : material.message,
    version: material.version, currentVersion: observed.currentVersion, text: observed.text, spreadsheet: observed.spreadsheet, document: observed.document, observedAt: observed.observedAt,
    taskId: draft.taskId, turnId: prior?.acknowledged ? prior.turnId : null, operationId: prior?.operationId ?? null };
}

export async function openFilePreview(root: string, input: unknown, host: { openPath(filename: string): Promise<string>; showItemInFolder(filename: string): void }) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 2 || !('source' in input) ||
    !('action' in input) || !['open', 'reveal'].includes(input.action as string)) throw new Error('文件打开请求无效');
  const value = await readFilePreview(root, input.source);
  if (input.action === 'open' && value.status !== 'ready') throw new Error(`${value.message}；未打开文件，请先核对版本`);
  if (input.action === 'open' && !['.txt', '.md', '.markdown', '.csv', '.xlsx', '.docx'].includes(path.extname(value.path).toLowerCase())) throw new Error('本阶段仅开放已核验文本、表格或 DOCX 文件的本机打开');
  try {
    const stat = await fs.lstat(value.path);
    if ((!stat.isFile() && !stat.isDirectory()) || stat.isSymbolicLink() || await fs.realpath(value.path) !== value.path) throw new Error('changed-path');
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code ?? (cause instanceof Error ? cause.message : 'unknown');
    throw new Error(`文件已移动、删除或路径不可核对，未打开替代位置（${code}）`);
  }
  if (input.action === 'open') {
    const error = await host.openPath(value.path);
    if (error) throw new Error(`系统未能打开文件：${error}`);
  } else host.showItemInFolder(value.path);
  // 系统接收请求不证明外部应用已完成阅读；定位接口本身没有完成回执。
  return { status: 'requested' as const };
}
