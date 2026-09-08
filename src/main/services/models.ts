import type { ModelSettings, ModelTestRequest } from '../../shared/contracts/models';
import { FLASH_MODEL_ID } from '../../shared/contracts/models';
import { readConfiguration, writeConfiguration } from '../storage/preferences';
import { decryptCredential, encryptCredential, verifyCredentialReference, writeCredential } from '../security/credentials';
import { readCatalog, writeCatalog, readModelTests, writeModelTest, finishModelTest, hasModelTest, beginKeySave, finishKeySave, readKeySaveFailure } from '../storage/models';
import { fetchDeepSeekModels, testDeepSeekFlash } from './deepseek';

interface ModelConnection {
  configRevision: number;
  enabled: boolean;
  selectedModelIds: string[];
  credentialRef: string | null;
  activeModelId: string | null;
}

export class ModelService {
  private saving = false;
  private testing: ModelTestRequest | null = null;
  private fetching = false;
  private fetchError: string | null = null;
  private keySaveError: string | null = null;
  constructor(private readonly root: string) {}

  // Main 执行协调专用；包含明文凭据，不属于 ModelSettings，也不得经 IPC 返回。
  async captureExecution(expectedRevision: unknown) {
    const check = () => {
      const state = this.read();
      if (!Number.isSafeInteger(expectedRevision) || state.configRevision !== expectedRevision) throw new Error('模型配置已变化，未开始执行');
      if (state.saving || state.keySaveError) throw new Error('密钥保存尚未成功，未开始执行');
      if (!state.enabled || !state.hasCredential) throw new Error('请先启用模型连接并保存 API Key');
      if (state.activeModelId !== FLASH_MODEL_ID || !state.selectedModelIds.includes(FLASH_MODEL_ID) || !state.catalog.modelIds.includes(FLASH_MODEL_ID)) throw new Error('执行只允许已选中的 deepseek-v4-flash');
      if (state.tests.some(result => result.modelId === FLASH_MODEL_ID && !result.expired && result.outcome === 'failed')) throw new Error('Flash 测试未成功，请先在设置中核对连接');
      return this.connection();
    };
    const before = check();
    const apiKey = await decryptCredential(this.root, before.credentialRef!);
    const after = check();
    if (after.credentialRef !== before.credentialRef) throw new Error('模型凭据已变化，未使用旧密钥开始执行');
    return Object.freeze({ modelId: FLASH_MODEL_ID, configRevision: before.configRevision, credentialRef: before.credentialRef!, apiKey });
  }

  private connection(): ModelConnection {
    const value = readConfiguration(this.root).modelConnection as ModelConnection | undefined;
    if (value === undefined) return { configRevision: 0, enabled: true, selectedModelIds: [], credentialRef: null, activeModelId: null };
    if (!value || typeof value !== 'object' || Object.keys(value).length !== 5 || !Number.isSafeInteger(value.configRevision) || value.configRevision < 0 ||
        typeof value.enabled !== 'boolean' || !Array.isArray(value.selectedModelIds) || value.selectedModelIds.some(id => typeof id !== 'string') ||
        (value.credentialRef !== null && (typeof value.credentialRef !== 'string' || !/^[a-f0-9-]{36}$/.test(value.credentialRef))) ||
        (value.activeModelId !== null && (typeof value.activeModelId !== 'string' || !value.selectedModelIds.includes(value.activeModelId)))) {
      throw new Error('模型配置格式不受支持，请勿覆盖原文件');
    }
    return value;
  }

  private sameConnection(snapshot: ModelConnection): boolean {
    const current = this.connection();
    // 工作台候选/活动选择是产品元数据，不改变固定地址下的凭据连接。
    return !this.saving && !this.read().keySaveError && current.enabled === snapshot.enabled && current.credentialRef === snapshot.credentialRef;
  }

  read(): ModelSettings {
    const value = this.connection();
    if (value.credentialRef) verifyCredentialReference(this.root, value.credentialRef);
    return { hasCredential: value.credentialRef !== null, configRevision: value.configRevision, enabled: value.enabled, selectedModelIds: value.selectedModelIds,
      catalog: readCatalog(this.root), saving: this.saving, fetching: this.fetching, fetchError: this.fetchError, activeModelId: value.activeModelId, keySaveError: this.keySaveError ?? (this.saving ? null : readKeySaveFailure(this.root, value.credentialRef)),
      testing: this.testing,
      tests: readModelTests(this.root).map(({ credentialRef, ...result }) => ({ ...result, expired: credentialRef !== value.credentialRef })) };
  }

  async fetchCatalog(input: unknown): Promise<ModelSettings> {
    if (this.read().keySaveError) throw new Error('上次密钥保存失败，请重新提交完整密钥；不会使用旧 Key 发送请求');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('拉取请求参数无效');
    const value = input as Record<string, unknown>;
    if (Object.keys(value).length !== 2 || typeof value.operationId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.operationId) || !Number.isSafeInteger(value.expectedRevision)) throw new Error('拉取请求参数无效');
    if (this.saving || this.fetching) throw new Error('保存或拉取尚未结束，请等待完成');
    const current = this.connection();
    if (current.configRevision !== value.expectedRevision) throw new Error('模型配置已变化，请重新读取后拉取');
    if (!current.enabled || !current.credentialRef) throw new Error('请先启用连接并保存 API Key');
    this.fetching = true;
    this.fetchError = null;
    try {
      const apiKey = await decryptCredential(this.root, current.credentialRef);
      if (!this.sameConnection(current)) throw new Error('配置已变化，未发送旧配置请求');
      const ids = await fetchDeepSeekModels(apiKey);
      if (!this.sameConnection(current)) throw new Error('配置已变化，本次旧列表未应用，请重新拉取');
      writeCatalog(this.root, ids, current.configRevision);
    } catch (cause) { this.fetchError = cause instanceof Error ? cause.message : '模型拉取失败'; }
    finally { this.fetching = false; }
    return this.read();
  }

  async test(input: unknown): Promise<ModelSettings> {
    if (this.read().keySaveError) throw new Error('上次密钥保存失败，请重新提交完整密钥；不会使用旧 Key 测试');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('模型测试参数无效');
    const value = input as Record<string, unknown>;
    if (Object.keys(value).length !== 3 || typeof value.operationId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.operationId) ||
        !Number.isSafeInteger(value.expectedRevision) || value.modelId !== FLASH_MODEL_ID) throw new Error('本阶段只允许测试 deepseek-v4-flash');
    if (this.saving || this.testing) throw new Error('保存或测试尚未结束，请等待完成');
    if (hasModelTest(this.root, value.operationId)) throw new Error('此测试操作已处理，不会重复调用模型');
    const current = this.connection();
    if (current.configRevision !== value.expectedRevision) throw new Error('模型配置已变化，请重新读取后测试');
    if (!current.enabled || !current.credentialRef || !readCatalog(this.root).modelIds.includes(FLASH_MODEL_ID)) throw new Error('请先启用连接、保存密钥并拉取 Flash');
    // 先记录操作，再产生可能计费的请求；结果落盘失败或进程退出也不能重复同一操作。
    writeModelTest(this.root, { modelId: FLASH_MODEL_ID, operationId: value.operationId, configRevision: current.configRevision,
      credentialRef: current.credentialRef, testedAt: new Date().toISOString(), durationMs: 0, outcome: 'failed',
      error: '测试结果尚未确认（进行中或上次中断），不会自动重试，请手动发起新测试' });
    this.testing = { operationId: value.operationId, expectedRevision: current.configRevision, modelId: FLASH_MODEL_ID };
    const started = Date.now();
    let error: string | null = null;
    try {
      const key = await decryptCredential(this.root, current.credentialRef);
      if (!this.sameConnection(current)) throw new Error('配置已变化，未发送旧配置测试');
      await testDeepSeekFlash(key);
    } catch (cause) { error = cause instanceof Error ? cause.message : '连接测试失败'; }
    try {
      finishModelTest(this.root, { modelId: FLASH_MODEL_ID, operationId: value.operationId, configRevision: current.configRevision,
        credentialRef: current.credentialRef, testedAt: new Date().toISOString(), durationMs: Date.now() - started,
        outcome: error ? 'failed' : 'passed', error });
    } finally { this.testing = null; }
    return this.read();
  }

  async reveal(expectedRevision: unknown): Promise<string> {
    const current = this.connection();
    if (!Number.isSafeInteger(expectedRevision) || current.configRevision !== expectedRevision) throw new Error('模型配置已变化，请重新读取');
    if (this.saving || !current.credentialRef) throw new Error('尚无可查看的已保存密钥');
    const plaintext = await decryptCredential(this.root, current.credentialRef);
    if (this.connection().configRevision !== expectedRevision) throw new Error('模型配置已变化，本次不显示旧密钥');
    return plaintext;
  }

  setEnabled(input: unknown): ModelSettings {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('连接设置参数无效');
    const value = input as Record<string, unknown>;
    if (Object.keys(value).length !== 3 || typeof value.operationId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.operationId) ||
        !Number.isSafeInteger(value.expectedRevision) || typeof value.enabled !== 'boolean') throw new Error('连接设置参数无效');
    if (this.saving) throw new Error('密钥正在保存，请等待完成');
    const current = this.connection();
    if (current.configRevision !== value.expectedRevision) throw new Error('模型配置已变化，请重新读取后提交');
    if (current.enabled !== value.enabled) {
      writeConfiguration(this.root, { ...readConfiguration(this.root), modelConnection: { ...current, enabled: value.enabled, configRevision: current.configRevision + 1 } });
    }
    return this.read();
  }

  setSelection(input: unknown): ModelSettings {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('模型选择参数无效');
    const value = input as Record<string, unknown>;
    if (Object.keys(value).length !== 3 || typeof value.operationId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.operationId) ||
        !Number.isSafeInteger(value.expectedRevision) || !Array.isArray(value.selectedModelIds) || value.selectedModelIds.length > 1000 ||
        value.selectedModelIds.some(id => typeof id !== 'string')) throw new Error('模型选择参数无效');
    if (this.saving) throw new Error('密钥正在保存，请等待完成');
    const current = this.connection();
    if (current.configRevision !== value.expectedRevision) throw new Error('模型配置已变化，请重新读取后提交');
    const allowed = new Set([...readCatalog(this.root).modelIds, ...current.selectedModelIds]);
    if (value.selectedModelIds.some(id => !allowed.has(id))) throw new Error('只能选择已拉取或此前已选的模型');
    const selectedModelIds = [...new Set<string>(value.selectedModelIds)];
    const activeModelId = current.activeModelId && selectedModelIds.includes(current.activeModelId) ? current.activeModelId : null;
    writeConfiguration(this.root, { ...readConfiguration(this.root), modelConnection: { ...current, selectedModelIds, activeModelId, configRevision: current.configRevision + 1 } });
    return this.read();
  }

  setActive(input: unknown): ModelSettings {
    if (this.read().keySaveError) throw new Error('上次密钥保存失败，请重新提交完整密钥后选择模型');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('工作台模型参数无效');
    const value = input as Record<string, unknown>;
    if (Object.keys(value).length !== 3 || typeof value.operationId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.operationId) ||
        !Number.isSafeInteger(value.expectedRevision) || (value.activeModelId !== null && typeof value.activeModelId !== 'string')) throw new Error('工作台模型参数无效');
    if (this.saving) throw new Error('密钥正在保存，请等待完成');
    const current = this.connection();
    if (current.configRevision !== value.expectedRevision) throw new Error('模型配置已变化，请重新读取后提交');
    const activeModelId = value.activeModelId as string | null;
    if (activeModelId !== null && (!current.enabled || !current.credentialRef || activeModelId !== FLASH_MODEL_ID ||
        !current.selectedModelIds.includes(activeModelId) || !readCatalog(this.root).modelIds.includes(activeModelId))) throw new Error('当前模型不可选择，本阶段只开放已选 Flash');
    if (activeModelId && this.read().tests.some(result => result.modelId === activeModelId && !result.expired && result.outcome === 'failed')) throw new Error('当前模型测试失败，请在设置中重新测试');
    if (current.activeModelId !== activeModelId) {
      writeConfiguration(this.root, { ...readConfiguration(this.root), modelConnection: { ...current, activeModelId, configRevision: current.configRevision + 1 } });
    }
    return this.read();
  }

  async saveKey(input: unknown): Promise<ModelSettings> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('密钥提交参数无效');
    const value = input as Record<string, unknown>;
    if (Object.keys(value).length !== 3 || typeof value.operationId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.operationId) ||
        !Number.isSafeInteger(value.expectedRevision) || typeof value.apiKey !== 'string' ||
        !/^[\x21-\x7e]{1,4096}$/.test(value.apiKey) || /^[*.]+$/.test(value.apiKey)) throw new Error('请输入完整的 API Key；空值、掩码和空白字符不会保存');
    if (this.saving) throw new Error('密钥正在保存，请等待完成');
    if (this.connection().configRevision !== value.expectedRevision) throw new Error('模型配置已变化，请重新读取后提交');
    this.saving = true;
    this.keySaveError = null;
    try {
      beginKeySave(this.root, this.connection().credentialRef);
      const encrypted = await encryptCredential(value.apiKey);
      const current = this.connection();
      if (current.configRevision !== value.expectedRevision) throw new Error('模型配置已变化，本次密钥未替换');
      const credentialRef = writeCredential(this.root, encrypted, current.credentialRef);
      const modelConnection = { ...current, credentialRef, configRevision: current.configRevision + 1 };
      writeConfiguration(this.root, { ...readConfiguration(this.root), modelConnection });
      finishKeySave(this.root);
      this.keySaveError = null;
    } catch (cause) {
      this.keySaveError = cause instanceof Error ? cause.message : '密钥保存失败';
      throw cause;
    } finally { this.saving = false; }
    return this.read();
  }
}
