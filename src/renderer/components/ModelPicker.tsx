import { useEffect, useRef, useState } from 'react';
import { FLASH_MODEL_ID, type ModelSettings } from '../../shared/contracts/models';

export function ModelPicker({ visible, openSettings, onSettingsChange }: { visible: boolean; openSettings: () => void; onSettingsChange?: (settings: ModelSettings | null) => void }) {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const loadSequence = useRef(0);
  useEffect(() => { onSettingsChange?.(visible && !error && !saving ? settings : null); }, [visible, error, saving, settings, onSettingsChange]);
  async function load() {
    const sequence = ++loadSequence.current;
    onSettingsChange?.(null);
    try { const loaded = await window.agentx.getModelSettings(); if (sequence === loadSequence.current) { setSettings(loaded); setError(''); } }
    catch (cause) { if (sequence === loadSequence.current) setError(cause instanceof Error ? cause.message : '模型配置读取失败'); }
  }
  useEffect(() => {
    if (!visible) return;
    const unsubscribe = window.agentx.onModelSettingsChanged(() => void load());
    void load();
    return () => { loadSequence.current++; setSettings(null); unsubscribe(); };
  }, [visible]);
  async function select(activeModelId: string) {
    if (!settings || saving) return;
    setSaving(true);
    try { setSettings(await window.agentx.setActiveModel({ operationId: crypto.randomUUID(), expectedRevision: settings.configRevision, activeModelId: activeModelId || null })); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '模型选择保存失败'); }
    finally { setSaving(false); }
  }
  if (error) return <div className="model-state"><span role="alert" className="error-message">{error}</span><button className="secondary-button" onClick={() => void load()}>重读模型</button></div>;
  if (!settings) return <span className="model-state">正在读取模型…</span>;
  if (settings.keySaveError) return <button className="model-state secondary-button" onClick={openSettings}>密钥保存失败，请重新配置</button>;
  if (!settings.hasCredential) return <button className="model-state secondary-button" onClick={openSettings}>配置模型</button>;
  if (!settings.enabled) return <span className="model-state">模型连接已关闭</span>;
  if (!settings.selectedModelIds.length) return <button className="model-state secondary-button" onClick={openSettings}>未选择可用模型</button>;
  return <select className="model-state" aria-label="模型" value={settings.activeModelId ?? ''} disabled={saving} onChange={event => void select(event.target.value)}>
    <option value="">选择模型</option>
    {settings.selectedModelIds.map(id => {
      const missing = !settings.catalog.modelIds.includes(id);
      const unsupported = id !== FLASH_MODEL_ID;
      const result = settings.tests.find(value => value.modelId === id);
      const failed = !!result && !result.expired && result.outcome === 'failed';
      return <option key={id} value={id} disabled={missing || unsupported || failed}>{id} · {missing ? '已失效' : unsupported ? '本阶段未开放' : result?.expired ? '测试已过期' : failed ? '测试失败' : result ? '测试成功' : '未测试'}</option>;
    })}
  </select>;
}
