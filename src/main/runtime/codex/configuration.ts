import fs from 'node:fs/promises';
import path from 'node:path';
import catalog from '../../../../runtime/deepseek-flash.models.json';
import { FLASH_MODEL_ID } from '../../../shared/contracts/models';
import type { CodexTransport } from './transport';
import type { ConfigReadParams } from '../../../../runtime/generated/codex/v2/ConfigReadParams';

export async function prepareCodexConfiguration(root: string, snapshot: { modelId: string; apiKey: string }, systemEnvironment: NodeJS.ProcessEnv = process.env) {
  if (!path.isAbsolute(root) || snapshot.modelId !== FLASH_MODEL_ID || !/^[\x21-\x7e]{1,4096}$/.test(snapshot.apiKey)) throw new Error('引擎配置无效，本阶段只支持 Flash 与有效凭据');
  let engineHome = await fs.realpath(root);
  for (const segment of ['engine', 'codex']) {
    engineHome = path.join(engineHome, segment);
    await fs.mkdir(engineHome, { recursive: true });
    const stat = await fs.lstat(engineHome);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('引擎数据目录不是普通目录，未写入配置');
  }
  const catalogPath = path.join(engineHome, 'models.json');
  const content = JSON.stringify(catalog) + '\n';
  try {
    const stat = await fs.lstat(catalogPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== Buffer.byteLength(content) || await fs.readFile(catalogPath, 'utf8') !== content) throw new Error('已有引擎模型目录与固定版本不同，未覆盖原文件');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await fs.writeFile(catalogPath, content, { encoding: 'utf8', flag: 'wx' });
  }
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(systemEnvironment)) {
    if (/^(SystemRoot|WINDIR|TEMP|TMP|PATH|PATHEXT|COMSPEC|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(key) && value !== undefined) environment[key] = value;
  }
  const shellSet = Object.entries(environment).map(([key, value]) => `${JSON.stringify(key)}=${JSON.stringify(value)}`).join(',');
  const overrides = [
    `model=${JSON.stringify(FLASH_MODEL_ID)}`, 'model_provider="deepseek"', 'model_reasoning_effort="low"',
    `model_catalog_json=${JSON.stringify(catalogPath)}`, 'approval_policy="on-request"', 'sandbox_mode="workspace-write"',
    'web_search="disabled"', 'check_for_update_on_startup=false', 'analytics.enabled=false', 'feedback.enabled=false',
    'features.plugins=false', 'windows.sandbox="unelevated"', 'sandbox_workspace_write.network_access=false',
    `shell_environment_policy={inherit="none",set={${shellSet}}}`,
    'model_providers.deepseek.name="DeepSeek"', 'model_providers.deepseek.base_url="https://api.deepseek.com"',
    'model_providers.deepseek.wire_api="responses"', 'model_providers.deepseek.env_key="AGENTX_API_KEY"',
    'model_providers.deepseek.requires_openai_auth=false', 'model_providers.deepseek.request_max_retries=0', 'model_providers.deepseek.stream_max_retries=0',
  ];
  // 必须在构造 shell 白名单之后加入引擎密钥，既不落盘，也不通过命令行参数传递。
  environment.AGENTX_API_KEY = snapshot.apiKey;
  return { engineHome, environment, overrides };
}

export async function verifyExecutionConfiguration(transport: CodexTransport, directory: string): Promise<void> {
  if (!path.isAbsolute(directory)) throw new Error('执行项目目录必须为绝对路径');
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('引擎生效配置结构无效，未发送任务');
    return value as Record<string, unknown>;
  };
  const params: ConfigReadParams = { cwd: directory, includeLayers: true };
  const result = object(await transport.call('config/read', params));
  const config = object(result.config);
  const provider = object(object(config.model_providers).deepseek);
  const shell = object(config.shell_environment_policy), shellSet = object(shell.set);
  const sandbox = object(config.sandbox_workspace_write), windows = object(config.windows);
  if (config.model !== FLASH_MODEL_ID || config.model_provider !== 'deepseek' ||
      config.approval_policy !== 'on-request' || config.sandbox_mode !== 'workspace-write' ||
      provider.base_url !== 'https://api.deepseek.com' || provider.wire_api !== 'responses' ||
      provider.env_key !== 'AGENTX_API_KEY' || provider.requires_openai_auth !== false ||
      sandbox.network_access !== false || windows.sandbox !== 'unelevated' || shell.inherit !== 'none' ||
      Object.keys(shellSet).some(key => !/^(SystemRoot|WINDIR|TEMP|TMP|PATH|PATHEXT|COMSPEC|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(key))) {
    // 不把包含凭据、环境或本地文件内容的原始配置拼入错误。
    throw new Error('引擎实际模型、连接、权限或 shell 环境与本轮配置不符，未发送任务');
  }
}
