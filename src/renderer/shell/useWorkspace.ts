import { useEffect, useRef, useState } from 'react';
import type { ProjectSummary, WorkspaceSnapshot } from '../../shared/contracts/projects';

export function useWorkspace() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [choosing, setChoosing] = useState(false);
  const [notice, setNotice] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProjectSummary | null>(null);
  const editTrigger = useRef<HTMLElement | null>(null);
  function startEditing(project: ProjectSummary, trigger: HTMLElement) { editTrigger.current = trigger; setEditing(project); }
  function closeEditor() {
    setEditing(null);
    requestAnimationFrame(() => { if (editTrigger.current?.isConnected) editTrigger.current.focus(); else document.querySelector<HTMLButtonElement>('[aria-label="展开侧栏"]')?.focus(); });
  }
  const loadSequence = useRef(0);
  async function load() {
    const sequence = ++loadSequence.current;
    setLoading(true);
    try { const value = await window.agentx.getWorkspace(); if (sequence === loadSequence.current) { setSnapshot(value); setError(''); } }
    catch (cause) { if (sequence === loadSequence.current) setError(cause instanceof Error ? cause.message : '项目和会话读取失败'); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }
  useEffect(() => {
    void load();
    const focus = () => void load();
    window.addEventListener('focus', focus);
    const unsubscribe = window.agentx.onWorkspaceChanged(() => void load());
    return () => { loadSequence.current++; unsubscribe(); window.removeEventListener('focus', focus); };
  }, []);
  async function choose() {
    if (choosing) return;
    setChoosing(true); setNotice(''); setActionError('');
    try {
      const value = await window.agentx.chooseProject({ operationId: crypto.randomUUID() });
      if (value.status === 'cancelled') setNotice('已取消选择');
      else {
        setSelectedProjectId(value.project.projectId);
        setSelectedTaskId(null);
        setNotice(value.status === 'duplicate' ? '已定位到关联过的项目' : '已关联项目，原文件仍在原目录');
        await load();
      }
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : '项目关联失败'); }
    finally { setChoosing(false); }
  }
  return { editing, startEditing, closeEditor, snapshot, loading, error, actionError, choosing, notice, selectedProjectId, setSelectedProjectId, selectedTaskId, setSelectedTaskId, load, choose };
}
