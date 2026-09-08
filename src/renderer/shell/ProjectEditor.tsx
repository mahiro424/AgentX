import { useEffect, useRef, useState } from 'react';
import type { ProjectSummary } from '../../shared/contracts/projects';

export function ProjectEditor({ project, onSaved, onClose }: { project: ProjectSummary; onSaved: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const savingRef = useRef(false);
  const [name, setName] = useState(project.displayName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); input.current?.focus(); input.current?.select(); }, []);
  async function save() {
    if (savingRef.current || composing.current) return;
    savingRef.current = true; setSaving(true); setError('');
    try {
      await window.agentx.renameProject({ operationId: crypto.randomUUID(), projectId: project.projectId, expectedRevision: project.revision, displayName: name });
      onSaved(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '项目名称保存失败，原记录未变更'); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return <dialog ref={dialog} className="project-editor" aria-labelledby="project-editor-heading" onCancel={event => { event.preventDefault(); if (!saving && !composing.current) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <header><h2 id="project-editor-heading">编辑项目</h2><button type="button" className="icon-button" aria-label="关闭项目编辑" disabled={saving} onClick={onClose}>×</button></header>
      <label htmlFor="project-name">项目名称</label>
      <input ref={input} id="project-name" value={name} readOnly={saving} maxLength={120} aria-invalid={!!error} aria-describedby={error ? 'project-save-error' : undefined}
        onChange={event => setName(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || composing.current)) event.preventDefault(); }} />
      <label htmlFor="project-directory">工作目录</label><input id="project-directory" value={project.directory} readOnly />
      {project.directoryState === 'unavailable' && <p role="alert" className="error-message">{project.directoryError}</p>}
      <p className="muted">修改名称不会移动磁盘目录，原文件和历史会话都会保留。</p>
      {error && <p id="project-save-error" role="alert" className="error-message">{error}</p>}
      {saving && <p role="status">正在保存名称…</p>}
      <footer><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>取消</button><button className="primary-button" type="submit" disabled={saving || !name.trim()}>保存名称</button></footer>
    </form>
  </dialog>;
}
