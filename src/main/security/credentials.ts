import { safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

function readSecrets(root: string): Record<string, string> {
  const file = path.join(root, 'secrets.enc');
  try {
    if (fs.statSync(file).size > 64 * 1024) throw new Error('size');
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value?.schemaVersion !== 1 || !value.credentials || typeof value.credentials !== 'object' || Array.isArray(value.credentials) ||
        Object.entries(value.credentials).some(([id, cipher]) => !/^[a-f0-9-]{36}$/.test(id) || typeof cipher !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(cipher))) throw new Error('format');
    return value.credentials;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error('无法读取系统密文文件，请检查文件权限或格式；原文件未覆盖');
  }
}

export function verifyCredentialReference(root: string, reference: string): void {
  if (!readSecrets(root)[reference]) throw new Error('配置关联的系统密文缺失，请检查本地凭据文件');
}

export async function encryptCredential(plaintext: string): Promise<Buffer> {
  try {
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('unavailable');
    return await safeStorage.encryptStringAsync(plaintext);
  } catch { throw new Error('系统凭据加密不可用，密钥未保存；请检查 Windows 用户加密环境后重试'); }
}

export async function decryptCredential(root: string, reference: string): Promise<string> {
  const cipher = readSecrets(root)[reference];
  if (!cipher) throw new Error('关联的系统密文缺失，请检查凭据文件');
  try {
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('unavailable');
    const decrypted = await safeStorage.decryptStringAsync(Buffer.from(cipher, 'base64'));
    if (!decrypted.result) throw new Error('empty');
    return decrypted.result;
  } catch { throw new Error('系统凭据解密失败，请确认使用原 Windows 用户及有效密文；不会改用明文或旧密钥'); }
}

export function writeCredential(root: string, encrypted: Buffer, currentReference: string | null): string {
  const previous = readSecrets(root);
  if (currentReference && !previous[currentReference]) throw new Error('旧凭据引用缺失，未覆盖原配置');
  const reference = randomUUID();
  // 先落新密文并保留当前引用；之后配置替换失败或崩溃，旧配置仍能解析。
  const credentials = { ...(currentReference ? { [currentReference]: previous[currentReference] } : {}), [reference]: encrypted.toString('base64') };
  const temporary = path.join(root, `secrets-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, credentials }) + '\n', { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, path.join(root, 'secrets.enc'));
  } catch (cause) {
    throw new Error(`系统密文写入失败（${(cause as NodeJS.ErrnoException).code ?? '文件写入失败'}），原配置未修改`);
  } finally {
    try { fs.unlinkSync(temporary); } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') console.error('系统密文临时文件未能清理，请检查数据目录权限');
    }
  }
  return reference;
}
