import { useEffect, useRef, useState } from 'react';
import type { OrganizedTaskSummary } from '../../shared/contracts/projects';

export function TaskEditor({ task, onSaved, onClose }: { task: OrganizedTaskSummary; onSaved: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const savingRef = useRef(false);
  const [title, setTitle] = useState(task.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); input.current?.focus(); input.current?.select(); }, []);
  async function save() {
    if (savingRef.current || composing.current) return;
    savingRef.current = true; setSaving(true); setError('');
    try {
      await window.agentx.renameTask({ operationId: crypto.randomUUID(), taskId: task.taskId, expectedRevision: task.organizationRevision, title });
      onSaved(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '会话名称保存失败，当前输入仍保留'); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return <dialog ref={dialog} className="project-editor" aria-labelledby="task-editor-heading"
    onCancel={event => { event.preventDefault(); if (!saving && !composing.current) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <header><h2 id="task-editor-heading">重命名会话</h2><button type="button" className="icon-button" aria-label="关闭会话编辑" disabled={saving} onClick={onClose}>×</button></header>
      <label htmlFor="task-name">会话名称</label>
      <input ref={input} id="task-name" value={title} readOnly={saving} aria-invalid={!!error} aria-describedby={error ? 'task-save-error' : 'task-name-help'}
        onChange={event => setTitle(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || composing.current)) event.preventDefault(); }} />
      <p id="task-name-help" className="muted">名称为 1 至 500 个字符；只更改名称，不改变历史、工作目录和最近活动时间。</p>
      {error && <p id="task-save-error" role="alert" className="error-message">{error}</p>}
      {saving && <p role="status">正在保存名称…</p>}
      <footer><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>取消</button><button className="primary-button" type="submit" disabled={saving || !title.trim()}>保存名称</button></footer>
    </form>
  </dialog>;
}
