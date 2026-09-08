import path from 'node:path';
import { realpath } from 'node:fs/promises';
import type { InitializeParams } from '../../../../runtime/generated/codex/InitializeParams';
import type { InitializeResponse } from '../../../../runtime/generated/codex/InitializeResponse';
import type { CodexTransport } from './transport';

export async function initializeCodex(transport: CodexTransport, expectedHome: string): Promise<InitializeResponse> {
  try {
    if (!path.isAbsolute(expectedHome)) throw new Error('引擎数据目录必须是绝对路径');
    const home = await realpath(expectedHome);
    const params: InitializeParams = {
      clientInfo: { name: 'agentx', title: 'AgentX', version: '0.1.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    };
    const result = await transport.call('initialize', params);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('引擎握手结构不兼容');
    const value = result as Record<string, unknown>;
    if (typeof value.userAgent !== 'string' || !value.userAgent ||
        typeof value.codexHome !== 'string' || !path.isAbsolute(value.codexHome) ||
        value.platformFamily !== 'windows' || value.platformOs !== 'windows') throw new Error('引擎握手结构或平台不兼容');
    // 使用已知目录的规范位置比较，不跟随引擎返回的其他目录读取配置。
    if (path.normalize(value.codexHome) !== home) throw new Error('引擎返回了不同的数据目录，拒绝继续执行');
    await transport.notify('initialized');
    return { userAgent: value.userAgent, codexHome: value.codexHome, platformFamily: value.platformFamily, platformOs: value.platformOs };
  } catch (error) {
    transport.close();
    throw error;
  }
}
