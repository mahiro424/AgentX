import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { MATERIAL_LIMITS, type MaterialRecord, type FrozenMaterialInput } from '../../shared/contracts/materials';
import type { DraftScope } from '../../shared/contracts/drafts';
import { materialIds, readMaterials, storeMaterial } from '../storage/materials';
import { readDraft } from '../storage/drafts';
import type { Spreadsheet } from '../../shared/contracts/spreadsheet';
import { readSpreadsheet, readDocument } from './spreadsheet';
import type { OfficeDocument } from '../../shared/contracts/document';

const identity = (stat: BigIntStats) => `${stat.dev}:${stat.ino}:${stat.isDirectory() ? 'directory' : `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`}`;
const validPath = (value: unknown): value is string => typeof value === 'string' && value.length <= 16000 && path.isAbsolute(value) && !/[\u0000-\u001f\u007f]/u.test(value);

export function pastedImageExtension(bytes: Buffer, mime: string): string {
  if (!Buffer.isBuffer(bytes) || bytes.length > MATERIAL_LIMITS.imageBytes) throw new Error('剪贴板图片无效或超过 8 MiB');
  if (mime === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (mime === 'image/jpeg' && bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'jpg';
  if (mime === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (mime === 'image/gif' && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return 'gif';
  if (mime === 'image/bmp' && bytes.toString('ascii', 0, 2) === 'BM') return 'bmp';
  throw new Error('剪贴板图片格式无效；请保存为 PNG、JPEG 或 WebP 后添加');
}

export async function inspectMaterialFile(filename: string, parseOffice = true): Promise<{ record: Omit<MaterialRecord, 'materialId'>; text: string | null; spreadsheet: Spreadsheet | null; document: OfficeDocument | null }> {
  const result = (record: Omit<MaterialRecord, 'materialId'>, text: string | null = null, spreadsheet: Spreadsheet | null = null, document: OfficeDocument | null = null) => ({ record, text, spreadsheet, document });
  let record: Omit<MaterialRecord, 'materialId'> = { path: filename, name: path.basename(filename), kind: 'unsupported',
    status: 'unreadable', message: '材料无法读取，请核对访问权限', version: null };
  try {
    const canonical = await fs.realpath(filename);
    const initial = await fs.lstat(canonical, { bigint: true });
    record = { ...record, path: canonical, name: path.basename(canonical) };
    if (initial.isSymbolicLink() || (!initial.isFile() && !initial.isDirectory())) return result(record);
    if (initial.isDirectory()) return result({ ...record, kind: 'directory', status: 'ready', message: '目录引用；不会自动遍历全部内容',
      version: { identity: identity(initial), size: 0, sha256: null } });
    const extension = path.extname(canonical).toLowerCase();
    const kind = ['.txt', '.md', '.markdown'].includes(extension) ? 'text' : ['.csv', '.xlsx'].includes(extension) ? 'spreadsheet' : extension === '.docx' ? 'document' : ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(extension) ? 'image' : 'unsupported';
    record = { ...record, kind };
    if (kind === 'unsupported') return result({ ...record, status: 'unsupported', message: '当前开放 TXT / Markdown、CSV / XLSX 与 DOCX；此格式暂不能发送' });
    const maxBytes = kind === 'image' ? MATERIAL_LIMITS.imageBytes : kind === 'spreadsheet' ? MATERIAL_LIMITS.spreadsheetBytes : kind === 'document' ? MATERIAL_LIMITS.documentBytes : MATERIAL_LIMITS.textBytes;
    if (initial.size > BigInt(maxBytes)) return result({ ...record, message: `材料超限：${kind === 'image' ? '图片最多 8 MiB' : kind === 'spreadsheet' ? '表格最多 8 MiB' : kind === 'document' ? '文档最多 8 MiB' : '文本最多 1 MiB'}` });
    const handle = await fs.open(canonical, 'r');
    try {
      if (identity(await handle.stat({ bigint: true })) !== identity(initial)) return result({ ...record, status: 'changed', message: '材料在核验期间发生变化，请重查' });
      const buffer = Buffer.alloc(Number(initial.size) + 1);
      let length = 0;
      while (length < buffer.length) {
        const result = await handle.read(buffer, length, buffer.length - length, length);
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      if (length !== Number(initial.size) || identity(initial) !== identity(await handle.stat({ bigint: true })) ||
        await fs.realpath(filename) !== canonical || identity(initial) !== identity(await fs.lstat(canonical, { bigint: true }))) {
        return result({ ...record, status: 'changed', message: '材料在核验期间发生变化，请重查' });
      }
      const bytes = buffer.subarray(0, length);
      record = { ...record, version: { identity: identity(initial), size: length, sha256: createHash('sha256').update(bytes).digest('hex') } };
      let text: string | null = null;
      let spreadsheet: Spreadsheet | null = null;
      let document: OfficeDocument | null = null;
      if (kind === 'text') {
        try {
          if (bytes.includes(0)) throw new Error('binary');
          text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        } catch { return result({ ...record, message: '文本不是有效 UTF-8，请转换编码后重新添加' }); }
      }
      if ((kind === 'spreadsheet' || kind === 'document') && parseOffice) {
        try { if (kind === 'spreadsheet') spreadsheet = await readSpreadsheet(bytes, extension); else document = await readDocument(bytes, extension); }
        catch (cause) { return result({ ...record, status: 'unreadable', message: cause instanceof Error ? cause.message : '办公文件解析失败，未返回空内容' }); }
        if (identity(initial) !== identity(await handle.stat({ bigint: true })) || await fs.realpath(filename) !== canonical ||
          identity(initial) !== identity(await fs.lstat(canonical, { bigint: true }))) return result({ ...record, status: 'changed', message: '材料在办公解析期间发生变化，请重查' });
      }
      return result({ ...record, status: kind === 'image' ? 'blockedImage' : 'ready',
        message: kind === 'image' ? '图像能力尚未验证，含图发送已阻断' : kind === 'spreadsheet' ? '表格可读取；公式未重算，尚不代表 Agent 已读取' : '可读取；尚不代表 Agent 已读取' }, text, spreadsheet, document);
    } finally { await handle.close(); }
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    return result({ ...record, status: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unreadable',
      message: code === 'ENOENT' || code === 'ENOTDIR' ? '材料已移动或删除，请恢复后重查' : '材料无法读取，请核对权限或磁盘连接' });
  }
}

function compareMaterial(record: MaterialRecord, current: Omit<MaterialRecord, 'materialId'>): MaterialRecord {
  if (current.path !== record.path || JSON.stringify(current.version) !== JSON.stringify(record.version)) return { ...record,
    status: current.status === 'missing' || current.status === 'unreadable' ? current.status : 'changed',
    message: current.status === 'missing' || current.status === 'unreadable' ? current.message : '材料内容或身份已变化；重查将采用新版本，原引用保留' };
  return { ...record, status: current.status, message: current.message };
}

export class MaterialService {
  constructor(private readonly root: string) {}

  async freeze(scope: DraftScope, text: string, input: unknown): Promise<FrozenMaterialInput> {
    const draft = readDraft(this.root, scope);
    if (input === undefined) {
      if (draft.materials.length) throw new Error('本草稿包含材料，发送不能遗漏材料引用');
      return { revision: draft.revision, records: [] };
    }
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 2 || !('revision' in input) ||
      !Number.isSafeInteger(input.revision) || !('ids' in input)) throw new Error('材料发送修订无效');
    const ids = materialIds(input.ids);
    if (input.revision !== draft.revision || draft.text !== text || JSON.stringify(ids) !== JSON.stringify(draft.materials.map(item => item.materialId))) {
      throw new Error('草稿或材料修订已变化，请等待保存后重新发送');
    }
    return { revision: draft.revision, records: await this.requireReady(ids) };
  }

  async requireReady(ids: string[]): Promise<MaterialRecord[]> {
    const records = await this.check(ids);
    const blocked = records.find(item => item.status !== 'ready');
    if (blocked) throw new Error(`${blocked.name}：${blocked.message}；未发送本次要求`);
    return records;
  }

  async pasteImage(bytes: Buffer, mime = 'image/png'): Promise<MaterialRecord> {
    const extension = pastedImageExtension(bytes, mime);
    const directory = path.join(await fs.realpath(this.root), 'materials', 'clipboard');
    await fs.mkdir(directory, { recursive: true });
    if (await fs.realpath(directory) !== directory || (await fs.lstat(directory)).isSymbolicLink()) throw new Error('材料保存目录已变化');
    const filename = path.join(directory, `粘贴图片-${createHash('sha256').update(bytes).digest('hex')}.${extension}`);
    try { await fs.writeFile(filename, bytes, { flag: 'wx' }); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error('剪贴板图片保存失败，未添加材料'); }
    const [record] = await this.register([filename]);
    if (record.version?.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw new Error('已保存的剪贴板图片发生变化，请核对材料目录');
    return record;
  }

  async register(paths: unknown): Promise<MaterialRecord[]> {
    if (!Array.isArray(paths) || paths.length > MATERIAL_LIMITS.count || paths.some(value => !validPath(value))) throw new Error('材料路径无效，单次最多添加 16 项');
    const result: MaterialRecord[] = [];
    for (const filename of new Set(paths as string[])) {
      const item = storeMaterial(this.root, { ...(await inspectMaterialFile(filename)).record, materialId: randomUUID() });
      if (!result.some(previous => previous.path === item.path || (item.version && previous.version?.identity === item.version.identity))) result.push(item);
    }
    return result;
  }

  async check(ids: unknown): Promise<MaterialRecord[]> {
    const records = readMaterials(this.root, ids);
    return Promise.all(records.map(async record => {
      const current = (await inspectMaterialFile(record.path, false)).record;
      const compared = compareMaterial(record, current);
      // 同版本重查只核验字节；不重复启动解析进程，也不能将原解析失败改写为成功。
      return ['spreadsheet', 'document'].includes(record.kind) && compared.status === 'ready' && record.status !== 'ready' ? { ...compared, status: record.status, message: record.message } : compared;
    }));
  }

  async preview(id: string) {
    const [record] = readMaterials(this.root, [id]), observed = await inspectMaterialFile(record.path);
    const material = compareMaterial(record, observed.record);
    return { material, currentVersion: observed.record.version, text: material.status === 'ready' ? observed.text : null,
      spreadsheet: material.status === 'ready' ? observed.spreadsheet : null,
      document: material.status === 'ready' ? observed.document : null,
      observedAt: new Date().toISOString() };
  }

  async refresh(id: unknown): Promise<MaterialRecord> {
    const [record] = readMaterials(this.root, [id]);
    return (await this.register([record.path]))[0];
  }
}
