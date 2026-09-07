import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Preferences } from '../../shared/contracts/app';

function validate(value: unknown): Preferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('偏好值无效');
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).length !== 2 || typeof candidate.theme !== 'string' || !['system', 'light', 'dark'].includes(candidate.theme) ||
      typeof candidate.zoom !== 'number' || ![0.75, 1, 1.25, 1.5].includes(candidate.zoom)) {
    throw new Error('主题或界面缩放值无效');
  }
  return { theme: candidate.theme as Preferences['theme'], zoom: candidate.zoom };
}

function readConfiguration(root: string): Record<string, unknown> & { schemaVersion: number; preferences: Preferences } {
  const file = path.join(root, 'config.json');
  let text: string;
  try {
    if (fs.statSync(file).size > 1024 * 1024) throw new Error('偏好文件超出大小限制');
    text = fs.readFileSync(file, 'utf8');
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { schemaVersion: 1, preferences: { theme: 'system', zoom: 1 } };
    throw new Error(`无法读取本地偏好（${code ?? '文件读取失败'}），原文件未修改`);
  }
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('本地偏好不是有效 JSON，原文件未修改'); }
  if (!data || typeof data !== 'object' || Array.isArray(data) || (data as { schemaVersion?: unknown }).schemaVersion !== 1) {
    throw new Error('本地偏好版本不受支持，原文件未修改');
  }
  return { ...data, schemaVersion: 1, preferences: validate((data as { preferences?: unknown }).preferences) };
}

export function readPreferences(root: string): Preferences {
  return readConfiguration(root).preferences;
}

export function savePreferences(root: string, value: unknown): Preferences {
  const preferences = validate(value);
  const configuration = readConfiguration(root);
  const temporary = path.join(root, `config-${randomUUID()}.tmp`);
  try {
    // Main 同步串行写入小配置；同目录替换避免失败时留下半份配置。
    fs.writeFileSync(temporary, JSON.stringify({ ...configuration, preferences }, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, path.join(root, 'config.json'));
  } catch (cause) {
    throw new Error(`无法保存本地偏好（${(cause as NodeJS.ErrnoException).code ?? '文件写入失败'}），原偏好未变更`);
  } finally {
    try { fs.unlinkSync(temporary); } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') console.error('偏好临时文件未能清理，请检查数据目录权限');
    }
  }
  return preferences;
}
