import { useEffect, useRef, useState } from 'react';
import type { ModelSettings as Settings } from '../../shared/contracts/models';
import { FLASH_MODEL_ID } from '../../shared/contracts/models';
import type { ExecutionState } from '../../shared/contracts/projects';

export function ModelSettings({ executionState }: { executionState: ExecutionState | 'preparing' | 'unavailable' | null }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [keyDraft, setKeyDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [changingConnection, setChangingConnection] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [testing, setTesting] = useState(false);
  const testPending = useRef(false);
  const [selecting, setSelecting] = useState(false);
  const fetchPending = useRef(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [revealedKey, setRevealedKey] = useState('');
  const [revealing, setRevealing] = useState(false);
  const revealEpoch = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function hideKey() {
    revealEpoch.current++;
    clearTimeout(hideTimer.current);
    setRevealed(false);
    setRevealedKey('');
    setRevealing(false);
  }
  async function toggleReveal() {
    if (revealed) { hideKey(); return; }
    if (!settings) return;
    const epoch = ++revealEpoch.current;
    setRevealing(true);
    try {
      const plaintext = keyDraft || await window.agentx.revealModelKey(settings.configRevision);
      if (epoch !== revealEpoch.current || !document.hasFocus()) return;
      setRevealedKey(keyDraft ? '' : plaintext);
      setRevealed(true);
      hideTimer.current = setTimeout(hideKey, 30000);
    } catch (cause) {
      if (epoch === revealEpoch.current) setError(cause instanceof Error ? cause.message : '密钥显示失败');
    } finally { if (epoch === revealEpoch.current) setRevealing(false); }
  }
  const pendingSave = useRef<Promise<boolean> | null>(null);
  async function selectModel(id: string, selected: boolean) {
    if (selecting) return;
    setSelecting(true);
    try {
      if (!await saveKey()) return;
      const current = await window.agentx.getModelSettings();
      const selectedModelIds = selected ? [...current.selectedModelIds, id] : current.selectedModelIds.filter(value => value !== id);
      setSettings(await window.agentx.setSelectedModels({ operationId: crypto.randomUUID(), expectedRevision: current.configRevision, selectedModelIds }));
      hideKey();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '模型选择保存失败'); }
    finally { setSelecting(false); }
  }
  async function testModel(modelId: string) {
    if (testPending.current) return;
    testPending.current = true;
    setTesting(true);
    try {
      if (!await saveKey()) return;
      const current = await window.agentx.getModelSettings();
      setSettings(await window.agentx.testModel({ operationId: crypto.randomUUID(), expectedRevision: current.configRevision, modelId }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '连接测试失败'); }
    finally { setTesting(false); testPending.current = false; }
  }
  function testStatus(id: string) {
    if (!settings) return null;
    if ((testing || settings.testing?.modelId === id) && id === FLASH_MODEL_ID) return <span role="status">测试中…</span>;
    const result = settings.tests.find(value => value.modelId === id);
    if (!result) return '未测试';
    return <><span className={result.expired ? 'muted' : result.outcome === 'passed' ? 'test-passed' : 'test-failed'}>
      {result.expired ? '测试已过期' : result.outcome === 'passed' ? '测试成功' : '测试失败'} · {new Date(result.testedAt).toLocaleString()}</span>
      <details><summary>查看测试详情</summary><p>{result.expired ? '配置已更换，请重新测试。' : ''}{result.error ?? '收到最小推理响应，不代表完整 Agent 能力已验证。'} 耗时 {result.durationMs} ms</p></details></>;
  }
  async function fetchModels() {
    if (fetchPending.current) return;
    fetchPending.current = true;
    setFetching(true);
    try {
      if (!await saveKey()) return;
      const current = await window.agentx.getModelSettings();
      setSettings(await window.agentx.fetchModelCatalog({ operationId: crypto.randomUUID(), expectedRevision: current.configRevision }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '模型拉取失败'); }
    finally { setFetching(false); fetchPending.current = false; }
  }
  async function toggleConnection() {
    if (changingConnection) return;
    setChangingConnection(true);
    try {
      if (!await saveKey()) return;
      const current = await window.agentx.getModelSettings();
      setSettings(await window.agentx.setModelConnectionEnabled({ operationId: crypto.randomUUID(), expectedRevision: current.configRevision, enabled: !current.enabled }));
      hideKey();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '连接设置保存失败'); }
    finally { setChangingConnection(false); }
  }
  function saveKey(): Promise<boolean> {
    if (pendingSave.current) return pendingSave.current;
    if (!keyDraft.trim() || !settings) return Promise.resolve(!error);
    setSaving(true);
    setError('');
    setSaveMessage('');
    const candidate = keyDraft.trim();
    const operation = window.agentx.saveModelKey({ operationId: crypto.randomUUID(), expectedRevision: settings.configRevision, apiKey: candidate })
      .then(saved => { setSettings(saved); setKeyDraft(''); hideKey(); setSaveMessage('密钥已保存'); return true; })
      .catch(cause => { setError(cause instanceof Error ? cause.message : '密钥保存失败'); return false; })
      .finally(() => { setSaving(false); pendingSave.current = null; });
    pendingSave.current = operation;
    return operation;
  }
  const loadSequence = useRef(0);
  async function load() {
    const sequence = ++loadSequence.current;
    setError('');
    try { const loaded = await window.agentx.getModelSettings(); if (sequence === loadSequence.current) { setSettings(loaded); setError(loaded.keySaveError ?? ''); } }
    catch (cause) { if (sequence === loadSequence.current) setError(cause instanceof Error ? cause.message : '模型配置读取失败'); }
  }
  useEffect(() => {
    const unsubscribe = window.agentx.onModelSettingsChanged(() => void load());
    void load();
    return () => { loadSequence.current++; unsubscribe(); };
  }, []);
  useEffect(() => { hideKey(); }, [settings?.configRevision]);
  useEffect(() => {
    const visibility = (visible: boolean) => { void window.agentx.setModelSettingsVisible(visible).catch(() => setError('设置页面授权状态同步失败，请重新打开设置')); };
    const focus = () => visibility(true);
    const blur = () => { hideKey(); setKeyDraft(''); visibility(false); };
    visibility(document.hasFocus());
    window.addEventListener('focus', focus);
    window.addEventListener('blur', blur);
    return () => { revealEpoch.current++; clearTimeout(hideTimer.current); window.removeEventListener('focus', focus); window.removeEventListener('blur', blur); visibility(false); };
  }, []);
  return <section className="settings-form" aria-labelledby="models-heading">
    <h2 id="models-heading">模型连接</h2>
    <p className="muted">首版使用 DeepSeek，按需选择工作台可用模型。</p>
    {executionState && ['preparing', 'submitting', 'running', 'waitingApproval', 'waitingInput', 'stopping'].includes(executionState)
      && <p role="status" className="muted">当前任务正在准备或执行，新配置仅对下一轮生效。关闭连接不会停止当前轮；如需立即停止，请返回该任务使用停止按钮并等待确认。</p>}
    {executionState && ['unavailable', 'reconciling', 'unconfirmed'].includes(executionState)
      && <p role="status" className="muted">执行状态尚未核对。保存配置或关闭连接不代表已有执行已停止；请先核对任务状态，不会自动重发。</p>}
    {!settings && !error && <p role="status">正在读取模型配置…</p>}
    {error && <div id="model-settings-error" role="alert" className="error-message">{error} <button className="secondary-button" onClick={() => void load()}>重试读取</button></div>}
    {settings && <>
      <div className="provider-heading"><h3>DeepSeek</h3><label className="provider-enabled">{settings.enabled ? '已启用' : '已关闭'}
        <button role="switch" className="toggle-switch" aria-label="启用 DeepSeek" aria-checked={settings.enabled} disabled={changingConnection}
          onClick={() => void toggleConnection()}><span /></button>
      </label></div>
      {!settings.enabled && <p role="status" className="muted">连接已关闭，密钥与模型选择已保留，新轮不可使用此连接。</p>}
      <label className="model-field">服务地址<span className="address-input"><input value="https://api.deepseek.com" readOnly /><span className="muted">固定地址</span></span></label>
      <div className="model-field"><label htmlFor="model-api-key">API Key</label><div className="key-input" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void saveKey(); }}>
        <input id="model-api-key" aria-invalid={!!keyDraft && !!error} aria-describedby={error ? "model-key-help model-settings-error" : "model-key-help"} type={revealed ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={keyDraft || revealedKey} readOnly={saving || settings.saving}
          placeholder={settings.hasCredential ? '••••••••（已保存，粘贴可替换）' : '粘贴 DeepSeek API Key'}
          onChange={event => { setRevealedKey(''); setKeyDraft(event.target.value); }}
          onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void saveKey(); } }} />
        <button className="icon-button" aria-label={revealed ? '隐藏 API Key' : '显示 API Key'} aria-pressed={revealed}
          disabled={saving || revealing || (!settings.hasCredential && !keyDraft)} onClick={() => void toggleReveal()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>{!revealed && <path d="m3 3 18 18"/>}</svg>
        </button></div>
      </div>
      <div id="model-key-help" className="key-help model-field"><span className="muted">粘贴新密钥后，离开输入框或按 Enter 保存。</span>
        <span role="status" className="muted">{saving || settings.saving ? '正在加密保存密钥…' : keyDraft ? '尚未保存' : error ? '' : saveMessage || (settings.hasCredential ? '已保存' : '')}</span></div>
      <div className="model-catalog-heading"><div><h3>可选模型</h3>
        {settings.catalog.fetchedAt ? <p className="catalog-summary muted">上次成功拉取：{new Date(settings.catalog.fetchedAt).toLocaleString()} · {settings.catalog.modelIds.length} 个模型 · 已选择 {settings.selectedModelIds.length} 个</p>
          : <p className="catalog-summary muted">{settings.hasCredential ? '尚未拉取模型。' : '尚未配置 API Key，未拉取模型。'}</p>}
        </div><button className="secondary-button"
        disabled={fetching || settings.fetching || !settings.enabled || (!settings.hasCredential && !keyDraft && !saving)}
        title={!settings.hasCredential && !keyDraft ? '请先配置 API Key' : '从官方地址读取候选模型，不自动测试'} onClick={() => void fetchModels()}>拉取模型</button></div>
      {(fetching || settings.fetching) && <p role="status">正在拉取模型，保留此前列表…</p>}
      {settings.fetchError && <p role="alert" className="error-message">{settings.fetchError}；可点击“拉取模型”重试。</p>}
      {settings.catalog.fetchedAt && settings.catalog.modelIds.length === 0 && <p role="status">服务返回空模型列表。</p>}
      {(settings.catalog.modelIds.length > 0 || settings.selectedModelIds.length > 0) && <table className="model-table"><thead><tr><th><span className="sr-only">选择</span></th><th>模型</th><th>连接测试</th><th>测试</th></tr></thead>
        <tbody>{[...new Set([...settings.catalog.modelIds, ...settings.selectedModelIds])].map(id => <tr key={id}><td><input type="checkbox" aria-label={`选择 ${id}`} checked={settings.selectedModelIds.includes(id)} disabled={selecting}
          onChange={event => void selectModel(id, event.target.checked)} /></td><td>{(id === FLASH_MODEL_ID || id === 'deepseek-v4-pro') && <div>{id === FLASH_MODEL_ID ? 'DeepSeek V4 Flash' : 'DeepSeek V4 Pro'}</div>}<span className="muted">{id}</span></td><td className="muted">{!settings.catalog.modelIds.includes(id) ? '已失效：本次列表未返回此模型' : id === FLASH_MODEL_ID ? testStatus(id) : '本阶段未开放'}</td><td><button className="icon-button" aria-label={`测试连接 ${id}`} title={id !== FLASH_MODEL_ID ? '本阶段未开放' : '测试连接'}
          disabled={testing || !!settings.testing || !settings.enabled || !settings.catalog.modelIds.includes(id) || id !== FLASH_MODEL_ID}
          onClick={() => void testModel(id)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M20 12a8 8 0 0 0-14-5M4 12a8 8 0 0 0 14 5"/></svg></button></td></tr>)}</tbody>
      </table>}
      <p className="muted">仅启用且选中的模型会显示在工作台；本阶段只开放 Flash。</p>
      <p className="muted">测试会发送不含工作材料的最小请求，并产生模型用量。</p>
      <p className="model-footnote muted">连接测试不代表工具或图像能力已通过验证。</p>
    </>}
  </section>;
}
