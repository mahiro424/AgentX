import type { useWorkspace } from './useWorkspace';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TaskPinIcon } from './TaskPinIcon';
import { TaskArchiveIcon } from './TaskArchiveIcon';
import type { ProjectSummary, OrganizedTaskSummary } from '../../shared/contracts/projects';
import { TaskStatus, taskStateLabel } from './TaskStatus';

export function ProjectSidebar({ workspace, openWorkbench }: { workspace: ReturnType<typeof useWorkspace>; openWorkbench: () => void }) {
  const { snapshot, loading, error, actionError, choosing, notice, selectedProjectId } = workspace;
  const [menu, setMenu] = useState<{ project: ProjectSummary; trigger: HTMLButtonElement; x: number; y: number } | null>(null);
  const menuElement = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!menu) return;
    menuElement.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: PointerEvent) => { if (!menuElement.current?.contains(event.target as Node)) setMenu(null); };
    const close = () => {
      setMenu(null);
      requestAnimationFrame(() => { if (menu.trigger.isConnected) menu.trigger.focus(); else document.querySelector<HTMLButtonElement>('[aria-label="展开侧栏"]')?.focus(); });
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', close);
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', close); };
  }, [menu]);
  const pinned = snapshot?.tasks.filter(task => task.pinnedAt !== null && task.archivedAt === null)
    .sort((a, b) => b.pinnedAt!.localeCompare(a.pinnedAt!) || a.taskId.localeCompare(b.taskId)) ?? [];
  const recent = snapshot?.tasks.filter(task => task.projectId === null && task.pinnedAt === null && task.archivedAt === null) ?? [];
  return <div className="project-navigation">
    {!!pinned.length && <section aria-label="置顶会话"><div className="project-group-heading">置顶</div>
      <ul className="session-list pinned-list">{pinned.map(task => <SessionRow key={task.taskId} task={task} workspace={workspace} openWorkbench={openWorkbench} />)}</ul>
    </section>}
    {workspace.taskActionError && <div role="alert" className="error-message">{workspace.taskActionError}<button className="secondary-button" onClick={() => void workspace.load()}>重读会话列表</button></div>}
    <div className="project-group-heading"><span>项目</span><button className="icon-button" aria-label="关联项目" title="关联项目" disabled={choosing} onClick={() => void workspace.choose()}>＋</button></div>
    {loading && <p role="status" className="muted">正在读取项目和会话…</p>}
    {choosing && <p role="status" className="muted">正在选择目录…</p>}
    {error && <div role="alert" className="error-message">{error}<button className="secondary-button" onClick={() => void workspace.load()}>重读项目和会话</button></div>}
    {actionError && <div role="alert" className="error-message">{actionError}<button className="secondary-button" disabled={choosing} onClick={() => void workspace.choose()}>重新选择目录</button></div>}
    {notice && <p role="status" className="navigation-notice">{notice}</p>}
    {workspace.lastArchived && snapshot?.tasks.some(task => task.taskId === workspace.lastArchived!.taskId && task.archivedAt !== null) &&
      <button className="secondary-button" aria-label="撤销归档" disabled={!!workspace.organizingTaskId} onClick={event => {
        const task = snapshot.tasks.find(task => task.taskId === workspace.lastArchived!.taskId)!;
        void workspace.archiveTask(task, event.currentTarget);
      }}>撤销归档</button>}
    {snapshot && !snapshot.projects.length && !snapshot.tasks.length && <div className="sidebar-empty"><p>尚无项目或会话</p><span>在工作台写下目标，也可以先选择本地项目。</span></div>}
    {snapshot?.projects.map(project => <section key={project.projectId} aria-label={`项目：${project.displayName}`}><div className="project-row" data-menu-open={menu?.project.projectId === project.projectId} data-unavailable={project.directoryState === 'unavailable'}>
      <button className="project-collapse icon-button" aria-label={`${collapsed.has(project.projectId) ? '展开' : '收起'}项目：${project.displayName}`} aria-expanded={!collapsed.has(project.projectId)}
        onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(project.projectId)) next.delete(project.projectId); else next.add(project.projectId); return next; })}>{collapsed.has(project.projectId) ? '›' : '⌄'}</button>
      <button className="project-select" title={project.directory}
      aria-current={selectedProjectId === project.projectId && !workspace.selectedTaskId ? 'page' : undefined}
      onClick={() => { workspace.setSelectedTaskId(null); workspace.setSelectedProjectId(project.projectId); void workspace.load(); openWorkbench(); }}><FolderIcon /><span>{project.displayName}</span></button>
      {project.directoryState === 'unavailable' && <span className="directory-unavailable" role="img" aria-label={`目录不可用：${project.displayName}`} title={project.directoryError ?? '目录不可用'}>!</span>}
      <div className="project-actions"><button className="icon-button" title="项目操作" aria-label={`项目操作：${project.displayName}`} aria-haspopup="menu" aria-expanded={menu?.project.projectId === project.projectId}
        onClick={event => { const box = event.currentTarget.closest('.project-row')!.getBoundingClientRect(); setMenu({ project, trigger: event.currentTarget, x: Math.min(box.right + 8, innerWidth - 196), y: Math.min(box.top, innerHeight - 64) }); }}>⋯</button>
      <button className="icon-button" title="编辑项目名称" aria-label={`编辑项目名称：${project.displayName}`} onClick={event => workspace.startEditing(project, event.currentTarget)}><PencilIcon /></button></div>
    </div>
      {!collapsed.has(project.projectId) && !!snapshot.tasks.filter(task => task.projectId === project.projectId && task.pinnedAt === null && task.archivedAt === null).length && <ul className="session-list" aria-label={`${project.displayName}的会话`}>
        {snapshot.tasks.filter(task => task.projectId === project.projectId && task.pinnedAt === null && task.archivedAt === null).map(task =>
          <SessionRow key={task.taskId} task={task} workspace={workspace} openWorkbench={openWorkbench} />)}
      </ul>}
    </section>)}
    {!!recent.length && <section aria-label="最近会话"><div className="project-group-heading">最近</div>
      <ul className="session-list">{recent.map(task => <SessionRow key={task.taskId} task={task} workspace={workspace} openWorkbench={openWorkbench} />)}</ul>
    </section>}
    {menu && createPortal(<div ref={menuElement} className="project-menu" role="menu" aria-label="项目操作" style={{ left: menu.x, top: menu.y }} onKeyDown={event => {
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); setMenu(null); menu.trigger.focus(); }
      if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { event.preventDefault(); menuElement.current?.querySelector<HTMLButtonElement>('button')?.focus(); }
    }}><button role="menuitem" onClick={() => { workspace.startEditing(menu.project, menu.trigger); setMenu(null); }}><PencilIcon />编辑名称</button></div>, document.body)}
  </div>;
}

function SessionRow({ task, workspace, openWorkbench }: { task: OrganizedTaskSummary; workspace: ReturnType<typeof useWorkspace>; openWorkbench: () => void }) {
  const archiveBlocked = !['idle', 'completed', 'failed', 'interrupted', 'unconfirmed'].includes(task.executionState);
  return <li className="session-item"><button className="session-row" aria-label={task.title} data-task-id={task.taskId}
    aria-current={workspace.selectedTaskId === task.taskId ? 'page' : undefined}
    title={`${task.title}\n${task.directory}\n${taskStateLabel[task.executionState]}\n最近活动：${new Date(task.lastActivityAt).toLocaleString('zh-CN')}`}
    onContextMenu={event => { event.preventDefault(); workspace.openTaskMenu(task, event.currentTarget, { x: event.clientX, y: event.clientY }); }}
    onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); workspace.openTaskMenu(task, event.currentTarget); } }}
    onClick={() => { workspace.setSelectedProjectId(task.projectId); workspace.setSelectedTaskId(task.taskId); openWorkbench(); }}>
    {task.pinnedAt !== null && <TaskPinIcon />}<span className="session-title">{task.title}</span><span className="session-activity" data-time-only={['idle', 'completed', 'interrupted'].includes(task.executionState)}><TaskStatus state={task.executionState} lastActivityAt={task.lastActivityAt} /></span>
  </button><div className="session-actions"><button className="icon-button" title={task.pinnedAt === null ? '置顶会话' : '取消置顶会话'}
    aria-label={`${task.pinnedAt === null ? '置顶会话' : '取消置顶会话'}：${task.title}`} disabled={!!workspace.organizingTaskId}
    onClick={event => void workspace.pinTask(task, event.currentTarget)}><TaskPinIcon /></button>
    <button className="icon-button" aria-label={`归档会话：${task.title}`} title={archiveBlocked ? '请先停止或核对执行，不能归档' : '归档会话'} disabled={!!workspace.organizingTaskId || archiveBlocked}
      onClick={event => void workspace.archiveTask(task, event.currentTarget)}><TaskArchiveIcon /></button></div></li>;
}

function PencilIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z" /></svg>;
}

export function FolderIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 7V5a1 1 0 0 1 1-1h6l2 3h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" /></svg>;
}
