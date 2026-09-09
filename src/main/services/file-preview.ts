import type { FilePreview, MaterialPreviewSource } from '../../shared/contracts/file-preview';
import { readDraft } from '../storage/drafts';
import { readInputMaterials } from '../storage/materials';
import { MaterialService } from './materials';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function readFilePreview(root: string, input: unknown): Promise<FilePreview> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 3 ||
    !('kind' in input) || input.kind !== 'material' || !('scope' in input) || !('materialId' in input) || typeof input.materialId !== 'string') throw new Error('文件预览请求无效');
  const source = input as MaterialPreviewSource;
  const draft = readDraft(root, source.scope);
  const prior = draft.taskId ? readInputMaterials(root, draft.taskId).filter(value => value.materials.some(item => item.materialId === source.materialId)).at(-1) : undefined;
  if (!draft.materials.some(item => item.materialId === source.materialId) && !prior) throw new Error('材料未关联当前草稿或会话，不能读取');
  const observed = await new MaterialService(root).preview(source.materialId);
  const { material } = observed;
  const unsupported = material.status === 'ready' && material.kind !== 'text';
  return { source, name: material.name, path: material.path, status: unsupported ? 'unsupported' : material.status,
    message: unsupported ? '此对象不提供文本预览；目录引用不会自动展开' : material.status === 'ready' ? '只读文本；内容不执行脚本' : material.message,
    version: material.version, currentVersion: observed.currentVersion, text: observed.text, observedAt: observed.observedAt,
    taskId: draft.taskId, turnId: prior?.acknowledged ? prior.turnId : null, operationId: prior?.operationId ?? null };
}

export async function openFilePreview(root: string, input: unknown, host: { openPath(filename: string): Promise<string>; showItemInFolder(filename: string): void }) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 2 || !('source' in input) ||
    !('action' in input) || !['open', 'reveal'].includes(input.action as string)) throw new Error('文件打开请求无效');
  const value = await readFilePreview(root, input.source);
  if (input.action === 'open' && value.status !== 'ready') throw new Error(`${value.message}；未打开文件，请先核对版本`);
  if (input.action === 'open' && !['.txt', '.md', '.markdown'].includes(path.extname(value.path).toLowerCase())) throw new Error('本阶段仅开放文本文件的本机打开');
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
