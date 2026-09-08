import { ProjectEditor } from './shell/ProjectEditor';
import { useWorkspace } from './shell/useWorkspace';
import { FolderIcon, ProjectSidebar } from './shell/ProjectSidebar';
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import type { AppInfo, Preferences } from '../shared/contracts/app';
import './styles.css';
import { ModelSettings } from './pages/ModelSettings';
import { ModelPicker } from './components/ModelPicker';

function App() {
  const workspace = useWorkspace();
  const selectedProject = workspace.snapshot?.projects.find(project => project.projectId === workspace.selectedProjectId);
  const selectedTask = workspace.snapshot?.tasks.find(task => task.taskId === workspace.selectedTaskId);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1040);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [view, setView] = useState<'workbench' | 'settings'>('workbench');
  const [settingsGroup, setSettingsGroup] = useState<'general' | 'models'>('general');
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState('');
  const [preferenceError, setPreferenceError] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const sidebarToggle = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);

  function openWorkbench() {
    setView('workbench');
    requestAnimationFrame(() => input.current?.focus());
  }

  function newSession() { workspace.setSelectedTaskId(null); openWorkbench(); }

  async function updatePreferences(value: Preferences) {
    setSaving(true);
    setPreferenceMessage('');
    setPreferenceError('');
    try {
      setPreferences(await window.agentx.savePreferences(value));
      setPreferenceMessage('已保存');
    } catch (cause) {
      console.error('AgentX 偏好保存失败', cause);
      setPreferenceError(`偏好保存失败，未改变原偏好。${cause instanceof Error ? cause.message : '未返回错误详情，请检查本地数据目录后重试。'}`);
    } finally { setSaving(false); }
  }

  useEffect(() => { document.documentElement.dataset.theme = preferences?.theme ?? 'system'; }, [preferences]);

  function toggleSidebar() {
    setSidebarOpen(open => !open);
    requestAnimationFrame(() => sidebarToggle.current?.focus());
  }

  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1040px)');
    const resize = () => {
      const focused = document.activeElement;
      const restoreFocus = wide.matches ? focused?.closest('.window-bar') : focused && sidebar.current?.contains(focused);
      setSidebarOpen(wide.matches);
      // 仅在原焦点所在导航被收起时转交焦点，不打断正在输入的用户。
      if (restoreFocus) requestAnimationFrame(() => sidebarToggle.current?.focus());
    };
    wide.addEventListener('change', resize);
    return () => wide.removeEventListener('change', resize);
  }, []);

  async function readAppInfo() {
    setError('');
    try {
      const [application, savedPreferences] = await Promise.all([window.agentx.getAppInfo(), window.agentx.getPreferences()]);
      setInfo(application);
      setPreferences(savedPreferences);
    } catch (cause) {
      console.error('AgentX 应用信息读取失败', cause);
      setError(`无法读取桌面应用信息或本地偏好。可以重试，草稿不会丢失。${cause instanceof Error ? cause.message : '未返回错误详情。'}`);
    }
  }

  useEffect(() => { void readAppInfo(); }, []);

  return <div className="app-shell">
    {workspace.editing && <ProjectEditor project={workspace.editing} onSaved={() => void workspace.load()} onClose={workspace.closeEditor} />}
    {sidebarOpen && <aside ref={sidebar} className="sidebar" aria-label="侧栏" style={{ width: sidebarWidth }}>
      <header className="brand drag-region"><span>AgentX</span><button ref={sidebarToggle} className="icon-button" aria-label="收起侧栏" onClick={toggleSidebar}><PanelIcon /></button></header>
      <button className="new-session" onClick={newSession}>
        <span aria-hidden="true">＋</span>新会话
      </button>
      <ProjectSidebar workspace={workspace} openWorkbench={openWorkbench} />
      <footer className="sidebar-footer">
        <span className="local-avatar" aria-hidden="true">本</span>
        <span>本地<span className="version">{info ? `v${info.version}` : '正在打开'}</span></span>
        <button className="settings-button" aria-label="设置" onClick={() => setView('settings')}><SettingsIcon /><span>设置</span></button>
      </footer>
      <div className="sidebar-divider" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical"
        aria-valuemin={200} aria-valuemax={360} aria-valuenow={sidebarWidth} tabIndex={0}
        onPointerDown={event => { event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setSidebarWidth(Math.max(200, Math.min(360, event.clientX))); }}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          setSidebarWidth(width => event.key === 'Home' ? 200 : event.key === 'End' ? 360 : Math.max(200, Math.min(360, width + (event.key === 'ArrowLeft' ? -16 : 16))));
        }} />
    </aside>}
    <div className="workspace">
      <header className="window-bar drag-region">{!sidebarOpen && <><button ref={sidebarToggle} className="icon-button" aria-label="展开侧栏" onClick={toggleSidebar}><PanelIcon /></button><button className="icon-button" aria-label="新会话" onClick={newSession}>＋</button><button className="icon-button" aria-label="设置" onClick={() => setView('settings')}><SettingsIcon /></button></>}</header>
      <main className="welcome" hidden={view !== 'workbench'}>
        <div className="welcome-heading">
          <h1>{selectedTask?.title ?? '今天想完成什么工作？'}</h1>
          <p>{selectedTask ? '当前仅展示产品会话记录；执行内容与历史读取尚未接入。' : '用自然语言描述目标，在这里开始工作。'}</p>
        </div>
        <div className="location"><FolderIcon /><select aria-label="工作目录" value={workspace.selectedProjectId ?? ''} disabled={workspace.choosing || !workspace.snapshot}
          title={workspace.snapshot?.projects.find(project => project.projectId === workspace.selectedProjectId)?.directory}
          onChange={event => { if (event.target.value === 'choose-directory') void workspace.choose(); else { workspace.setSelectedTaskId(null); workspace.setSelectedProjectId(event.target.value || null); } }}>
          <option value="">未关联项目</option>
          {workspace.snapshot?.projects.map(project => <option key={project.projectId} value={project.projectId}>{project.displayName}</option>)}
          <option value="choose-directory">选择本地文件夹…</option>
        </select></div>
        <section className="composer" aria-label="任务输入">
          <label className="sr-only" htmlFor="task-draft">任务要求</label>
          <textarea id="task-draft" ref={input} value={draft} onChange={event => setDraft(event.target.value)}
            placeholder="描述你想完成的工作…" />
          <div className="composer-toolbar">
            <span className="muted">请求批准</span>
            <ModelPicker visible={view === 'workbench'} openSettings={() => { setSettingsGroup('models'); setView('settings'); }} />
            <button className="send-button" aria-label="发送" aria-describedby="send-unavailable" title="执行功能尚未接入" disabled>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 20V4m-7 7 7-7 7 7" /></svg>
            </button>
          </div>
        </section>
        <p id="send-unavailable" role="note" className={selectedProject?.directoryState === 'unavailable' ? 'error-message' : 'muted'}>{selectedProject?.directoryState === 'unavailable'
          ? `工作目录不可用：${selectedProject.directoryError}。不能在此目录开始新执行，原会话关联仍保留。` : '执行功能尚未接入，暂不能发送任务。'}</p>
      </main>
      <main className="settings" hidden={view !== 'settings'}>
        <header className="settings-header"><h1>设置</h1><button className="secondary-button" onClick={openWorkbench}>返回工作台</button></header>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="设置分类">
            <button aria-current={settingsGroup === 'general' ? 'page' : undefined} onClick={() => setSettingsGroup('general')}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 6h8m4 0h6M3 18h2m4 0h12"/><circle cx="13" cy="6" r="2"/><circle cx="7" cy="18" r="2"/></svg>通用</button>
            <button aria-current={settingsGroup === 'models' ? 'page' : undefined} onClick={() => setSettingsGroup('models')}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m9 15 6-6m-7 3-3 3a4 4 0 0 0 6 6l3-3m2-6 3-3a4 4 0 0 0-6-6l-3 3"/></svg>模型连接</button>
          </nav>
          <section className="settings-form" aria-labelledby="general-heading" hidden={settingsGroup !== 'general'}>
            <h2 id="general-heading">通用</h2>
            <p className="muted">调整桌面外观，不影响工作内容。</p>
            <fieldset disabled={!preferences || saving}>
              <legend>外观</legend>
              <div className="setting-row"><span id="theme-label">主题</span><div className="theme-options" role="group" aria-labelledby="theme-label">
                {([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']] as const).map(([theme, label]) => <button key={theme}
                  aria-pressed={preferences?.theme === theme} onClick={() => preferences && void updatePreferences({ ...preferences, theme })}>{label}</button>)}
              </div></div>
              <div className="setting-row"><label htmlFor="interface-zoom">界面缩放</label><select id="interface-zoom" value={preferences?.zoom ?? 1}
                onChange={event => preferences && void updatePreferences({ ...preferences, zoom: Number(event.target.value) })}>
                {[0.75, 1, 1.25, 1.5].map(zoom => <option key={zoom} value={zoom}>{zoom * 100}%</option>)}
              </select></div>
            </fieldset>
            {saving && <p role="status">正在保存偏好…</p>}
            {preferenceMessage && <p role="status" className="muted">{preferenceMessage}</p>}
            {preferenceError && <p role="alert" className="error-message">{preferenceError}</p>}
          </section>
          {view === 'settings' && settingsGroup === 'models' && <ModelSettings />}
        </div>
      </main>
      <div className="read-status">
        {(!info || !preferences) && !error && <p role="status" className="muted">正在读取应用信息与本地偏好…</p>}
        {error && <div role="alert" className="error-message">{error} <button className="secondary-button" onClick={() => void readAppInfo()}>重试</button></div>}
      </div>
    </div>
  </div>;
}

function PanelIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>;
}

function SettingsIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m9 3 1-1h4l1 1 1 3 3 1 2 3-1 3 1 3-2 3-3 1-1 2H9l-1-2-3-1-2-3 1-3-1-3 2-3 3-1z" transform="translate(0 -1) scale(1 .95)" /><circle cx="12" cy="11.5" r="3" /></svg>;
}

const root = document.getElementById('root');
if (!root) throw new Error('AgentX 页面缺少根节点');
createRoot(root).render(<App />);
