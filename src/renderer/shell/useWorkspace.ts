import { useEffect, useRef, useState } from 'react';
import type { ProjectSummary, WorkspaceSnapshot, OrganizedTaskSummary } from '../../shared/contracts/projects';

export interface TaskMenuState { task: OrganizedTaskSummary; trigger: HTMLElement; x: number; y: number }

export function useWorkspace() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [choosing, setChoosing] = useState(false);
  const [notice, setNotice] = useState('');
  const [taskActionError, setTaskActionError] = useState('');
  const [organizingTaskId, setOrganizingTaskId] = useState<string | null>(null);
  const [lastArchived, setLastArchived] = useState<OrganizedTaskSummary | null>(null);
  const organizing = useRef(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProjectSummary | null>(null);
  const editTrigger = useRef<HTMLElement | null>(null);
  const [taskMenu, setTaskMenu] = useState<TaskMenuState | null>(null);
  const [editingTask, setEditingTask] = useState<OrganizedTaskSummary | null>(null);
  const taskEditTrigger = useRef<HTMLElement | null>(null);
  function openTaskMenu(task: OrganizedTaskSummary, trigger: HTMLElement, point?: { x: number; y: number }) {
    const box = trigger.getBoundingClientRect();
    setTaskMenu({ task, trigger, x: Math.max(8, Math.min(point?.x ?? box.left, innerWidth - 204)),
      y: Math.max(8, Math.min(point?.y ?? box.bottom + 8, innerHeight - 156)) });
  }
  function closeTaskMenu(restoreFocus = true) {
    if (restoreFocus) restoreTaskFocus(taskMenu?.trigger ?? null);
    setTaskMenu(null);
  }
  function startTaskEditing() {
    if (!taskMenu) return;
    taskEditTrigger.current = taskMenu.trigger; setEditingTask(taskMenu.task); setTaskMenu(null);
  }
  async function pinTask(task: OrganizedTaskSummary, trigger: HTMLElement | null) {
    if (organizing.current) return;
    organizing.current = true; setOrganizingTaskId(task.taskId); setTaskActionError(''); setNotice(''); setTaskMenu(null);
    const focused = document.activeElement;
    try {
      await window.agentx.setTaskPinned({ operationId: crypto.randomUUID(), taskId: task.taskId,
        expectedRevision: task.organizationRevision, pinned: task.pinnedAt === null });
      await load();
      setNotice(task.pinnedAt === null ? '已置顶会话' : task.projectId === null ? '已取消置顶，会话回到最近分组' : '已取消置顶，会话仍在原项目');
    } catch (cause) { setTaskActionError(cause instanceof Error ? cause.message : '会话置顶操作失败，请重读列表后重试'); }
    finally {
      organizing.current = false; setOrganizingTaskId(null);
      requestAnimationFrame(() => {
        if (document.activeElement !== focused && document.activeElement !== document.body) return;
        restoreTaskFocus(trigger?.isConnected ? trigger : document.querySelector<HTMLElement>(`[data-task-id="${task.taskId}"]`));
      });
    }
  }
  async function archiveTask(task: OrganizedTaskSummary, trigger: HTMLElement | null) {
    if (organizing.current) return;
    organizing.current = true; setOrganizingTaskId(task.taskId); setTaskActionError(''); setNotice(''); setTaskMenu(null);
    const focused = document.activeElement;
    try {
      const saved = await window.agentx.setTaskArchived({ operationId: crypto.randomUUID(), taskId: task.taskId,
        expectedRevision: task.organizationRevision, archived: task.archivedAt === null });
      setLastArchived(saved.archivedAt ? saved : null);
      // 写入应答已确认组织修订；只合并组织字段，不以旧应答覆盖新的执行观测。
      setSnapshot(previous => previous ? { ...previous, tasks: previous.tasks.map(value => value.taskId === saved.taskId && value.organizationRevision <= saved.organizationRevision
        ? { ...value, title: saved.title, organizationRevision: saved.organizationRevision, pinnedAt: saved.pinnedAt, archivedAt: saved.archivedAt } : value) } : previous);
      if (await load()) setNotice(saved.archivedAt ? '已归档会话，原历史和文件仍保留' : '已恢复会话，没有开始执行');
      else setTaskActionError(`${saved.archivedAt ? '归档' : '恢复'}已保存，但列表尚未核对；请重读会话列表，不要重复提交。`);
    } catch (cause) { setTaskActionError(cause instanceof Error ? cause.message : '会话归档或恢复失败，请重读列表后重试'); }
    finally {
      organizing.current = false; setOrganizingTaskId(null);
      requestAnimationFrame(() => {
        if (document.activeElement !== focused && document.activeElement !== document.body) return;
        restoreTaskFocus(trigger?.isConnected ? trigger : document.querySelector<HTMLElement>(`[data-task-id="${task.taskId}"]`) ??
          document.querySelector<HTMLElement>('[aria-label="恢复会话"], [aria-label="撤销归档"]'));
      });
    }
  }
  function closeTaskEditor() { setEditingTask(null); requestAnimationFrame(() => restoreTaskFocus(taskEditTrigger.current)); }
  function startEditing(project: ProjectSummary, trigger: HTMLElement) { editTrigger.current = trigger; setEditing(project); }
  function closeEditor() {
    setEditing(null);
    requestAnimationFrame(() => { if (editTrigger.current?.isConnected) editTrigger.current.focus(); else document.querySelector<HTMLButtonElement>('[aria-label="展开侧栏"]')?.focus(); });
  }
  const loadSequence = useRef(0);
  async function load(): Promise<boolean> {
    const sequence = ++loadSequence.current;
    setLoading(true);
    try { const value = await window.agentx.getWorkspace(); if (sequence === loadSequence.current) { setSnapshot(value); setError(''); return true; } return false; }
    catch (cause) { if (sequence === loadSequence.current) setError(cause instanceof Error ? cause.message : '项目和会话读取失败'); return false; }
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
  return { archiveTask, lastArchived, pinTask, taskActionError, organizingTaskId, editing, startEditing, closeEditor, taskMenu, openTaskMenu, closeTaskMenu, editingTask, startTaskEditing, closeTaskEditor,
    snapshot, loading, error, actionError, choosing, notice, selectedProjectId, setSelectedProjectId, selectedTaskId, setSelectedTaskId, load, choose };
}

function restoreTaskFocus(trigger: HTMLElement | null) {
  if (trigger?.isConnected) trigger.focus();
  else document.querySelector<HTMLElement>('[aria-label="展开侧栏"], #task-draft')?.focus();
}
