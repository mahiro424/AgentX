import { ProjectEditor } from './shell/ProjectEditor';
import { TaskEditor } from './shell/TaskEditor';
import { TaskMenu } from './shell/TaskMenu';
import { ExitDialog } from './shell/ExitDialog';
import { useWorkspace } from './shell/useWorkspace';
import { FolderIcon, ProjectSidebar } from './shell/ProjectSidebar';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import type { AppInfo, Preferences } from '../shared/contracts/app';
import './styles.css';
import { ModelSettings } from './pages/ModelSettings';
import { ModelPicker } from './components/ModelPicker';
import { useExecution } from './workbench/useExecution';
import { useHistory } from './workbench/useHistory';
import { HistoryTimeline } from './workbench/HistoryTimeline';
import { ReconciliationNotice } from './workbench/ReconciliationNotice';
import { ResultsPanel } from './workbench/ResultsPanel';
import { OutputPanel } from './workbench/OutputPanel';
import type { CommandItem } from '../shared/contracts/execution';
import { useDraft } from './workbench/useDraft';
import { ExecutionTimeline } from './workbench/ExecutionTimeline';
import { taskStateLabel } from './shell/TaskStatus';
import { FLASH_MODEL_ID, type ModelSettings as ModelConfiguration } from '../shared/contracts/models';

function App() {
  const workspace = useWorkspace();
  const execution = useExecution();
  const [executionActionError, setExecutionActionError] = useState<{ taskId: string | null; turnId?: string; message: string } | null>(null);
  const [stoppingTaskId, setStoppingTaskId] = useState<string | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<Set<string>>(new Set());
  const approvalLocks = useRef(new Set<string>());
  const currentExecution = execution.snapshot?.task?.taskId === workspace.selectedTaskId ? execution.snapshot : null;
  const currentState = currentExecution?.task?.executionState;
  const stopping = stoppingTaskId !== null && stoppingTaskId === currentExecution?.task?.taskId;
  const showStop = !!currentState && ['running', 'waitingApproval', 'waitingInput', 'stopping'].includes(currentState);

  useEffect(() => {
    const task = execution.snapshot?.task;
    if (task && task.taskId === stoppingTaskId && !['running', 'waitingApproval', 'waitingInput'].includes(task.executionState)) setStoppingTaskId(null);
  }, [execution.snapshot, stoppingTaskId]);

  async function stopExecution() {
    const task = currentExecution?.task;
    if (!task?.threadId || !task.turnId || stopping) return;
    setStoppingTaskId(task.taskId); setExecutionActionError(null);
    try { await window.agentx.stopExecution({ taskId: task.taskId, operationId: crypto.randomUUID(), threadId: task.threadId, turnId: task.turnId }); }
    catch (cause) { setExecutionActionError({ taskId: task.taskId, turnId: task.turnId, message: cause instanceof Error ? cause.message : '停止请求失败，请核对状态' }); }
    finally {
      // 等到最新读取落地；仅收到停止 IPC 应答时不能短暂重新开放停止按钮。
      if (await execution.load()) setStoppingTaskId(previous => previous === task.taskId ? null : previous);
    }
  }
  async function answerApproval(approvalToken: string, decision: 'accept' | 'decline') {
    const task = currentExecution?.task;
    if (!task?.threadId || !task.turnId || currentState !== 'waitingApproval' || approvalLocks.current.has(approvalToken) || execution.error) return;
    approvalLocks.current.add(approvalToken); setPendingApprovals(new Set(approvalLocks.current)); setExecutionActionError(null);
    try { await window.agentx.answerExecutionApproval({ taskId: task.taskId, operationId: crypto.randomUUID(), threadId: task.threadId, turnId: task.turnId, approvalToken, decision }); }
    catch (cause) { setExecutionActionError({ taskId: task.taskId, turnId: task.turnId, message: cause instanceof Error ? cause.message : '审批回答失败，请核对状态' }); }
    finally {
      await execution.load();
      approvalLocks.current.delete(approvalToken); setPendingApprovals(new Set(approvalLocks.current));
    }
  }
  const selectedProject = workspace.snapshot?.projects.find(project => project.projectId === workspace.selectedProjectId);
  const selectedTask = workspace.snapshot?.tasks.find(task => task.taskId === workspace.selectedTaskId);
  const visibleExecutionError = executionActionError?.taskId === workspace.selectedTaskId && (!executionActionError.turnId || executionActionError.turnId === selectedTask?.turnId) ? executionActionError.message : '';
  const [resultsTask, setResultsTask] = useState<string | null>(null);
  const resultsTrigger = useRef<HTMLButtonElement>(null);
  const canInspect = !!selectedTask?.turnId && ['completed', 'failed', 'interrupted'].includes(selectedTask.executionState);
  const resultsOpen = canInspect && resultsTask === selectedTask?.taskId;
  const history = useHistory(selectedTask?.taskId ?? null, canInspect ? selectedTask!.turnId : null);
  const hasCurrentHistory = !!currentExecution?.task?.turnId && !!history.value?.turns.some(turn => turn.turnId === currentExecution.task!.turnId);
  const [outputSelection, setOutputSelection] = useState<{ taskId: string; threadId: string; turnId: string; itemId: string } | null>(null);
  const outputTrigger = useRef<HTMLButtonElement | null>(null);
  const outputItem = outputSelection?.taskId === workspace.selectedTaskId
    ? [...(history.value?.turns.flatMap(turn => turn.items) ?? []), ...(hasCurrentHistory ? [] : currentExecution?.items ?? [])].find((item): item is CommandItem => item.kind === 'command' &&
      item.threadId === outputSelection.threadId && item.turnId === outputSelection.turnId && item.itemId === outputSelection.itemId) : undefined;
  function openOutput(item: CommandItem, trigger: HTMLButtonElement) {
    if (!workspace.selectedTaskId) return;
    outputTrigger.current = trigger; setResultsTask(null);
    setOutputSelection({ taskId: workspace.selectedTaskId, threadId: item.threadId, turnId: item.turnId, itemId: item.itemId });
  }
  const draftState = useDraft({ projectId: workspace.selectedProjectId, taskId: workspace.selectedTaskId });
  const draft = draftState.text, setDraft = draftState.setText;
  const [modelConfiguration, setModelConfiguration] = useState<ModelConfiguration | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const selection = useRef({ projectId: workspace.selectedProjectId, taskId: workspace.selectedTaskId, generation: 0 });
  if (selection.current.projectId !== workspace.selectedProjectId || selection.current.taskId !== workspace.selectedTaskId) selection.current.generation++;
  selection.current.projectId = workspace.selectedProjectId;
  selection.current.taskId = workspace.selectedTaskId;
  const busyTask = workspace.snapshot?.tasks.find(task => !['idle', 'completed', 'failed', 'interrupted'].includes(task.executionState));
  const reconciliationTaskIds = execution.snapshot?.reconciliationTaskIds ?? [];
  const reconciliationTaskId = selectedTask?.executionState === 'reconciling' || (selectedTask && reconciliationTaskIds.includes(selectedTask.taskId))
    ? selectedTask!.taskId : reconciliationTaskIds[0] ?? (busyTask?.executionState === 'reconciling' ? busyTask.taskId : null);
  const blockedReason = submitting || execution.snapshot?.preparing ? '正在提交，请等待确认，不会重复发送。'
    : draftState.loading || draftState.saving || draftState.error ? '请先确认草稿已读取并保存。'
    : !workspace.snapshot || workspace.error || !execution.snapshot || execution.error ? '请先完成项目和执行状态读取。'
    : reconciliationTaskIds.length ? '存在引擎或后台回收待核对，不会发送新任务。'
    : busyTask ? '有活动或待核对任务，不能开始另一个任务。'
    : workspace.selectedTaskId && (!selectedTask?.threadId || !canInspect) ? '本会话没有已确认结束的轮次，请先核对状态。'
    : !selectedProject ? '请先选择本地项目。'
    : selectedProject.directoryState !== 'available' ? '工作目录不可用，不能开始执行。'
    : !modelConfiguration ? '正在读取可用模型配置。'
    : modelConfiguration.saving || modelConfiguration.keySaveError ? '密钥尚未保存成功，请检查模型设置。'
    : !modelConfiguration.enabled || !modelConfiguration.hasCredential ? '请先启用模型连接并保存 API Key。'
    : modelConfiguration.activeModelId !== FLASH_MODEL_ID || !modelConfiguration.selectedModelIds.includes(FLASH_MODEL_ID) || !modelConfiguration.catalog.modelIds.includes(FLASH_MODEL_ID) ? '请选择可用的 deepseek-v4-flash。'
    : modelConfiguration.tests.some(result => result.modelId === FLASH_MODEL_ID && !result.expired && result.outcome === 'failed') ? 'Flash 测试失败，请先检查模型连接。'
    : !draft.trim() ? '输入任务要求后发送。' : '';
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState('');
  const draftRevision = useRef(0);
  const [steeringTaskId, setSteeringTaskId] = useState<string | null>(null);
  const [steerNotice, setSteerNotice] = useState<{ taskId: string; turnId: string; message: string } | null>(null);
  const canSteer = !!currentState && ['running', 'waitingApproval', 'waitingInput'].includes(currentState);
  useEffect(() => { draftRevision.current++; }, [workspace.selectedProjectId, workspace.selectedTaskId]);

  async function sendTurn() {
    if (blockedReason || submitLock.current || !selectedProject || !modelConfiguration) return;
    const previousTaskId = workspace.selectedTaskId;
    const request = { taskId: selectedTask?.taskId ?? crypto.randomUUID(), operationId: crypto.randomUUID(), projectId: selectedProject.projectId,
      modelId: FLASH_MODEL_ID, configRevision: modelConfiguration.configRevision, text: draft };
    const revision = ++draftRevision.current, generation = selection.current.generation;
    const stillHere = () => selection.current.projectId === request.projectId && selection.current.taskId === previousTaskId && selection.current.generation === generation;
    submitLock.current = true; setSubmitting(true); setExecutionActionError(null);
    try {
      const task = selectedTask
        ? await window.agentx.continueExecution({ ...request, threadId: selectedTask.threadId!, expectedTurnId: selectedTask.turnId! })
        : await window.agentx.startExecution(request);
      if (stillHere()) {
        if (!selectedTask && draftRevision.current !== revision) draftState.seedNewTask({ projectId: request.projectId, taskId: task.taskId }, draftState.latestText());
        workspace.setSelectedTaskId(task.taskId);
        if (draftRevision.current === revision) setDraft('');
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '发送失败，请先核对执行状态';
      if (stillHere()) setExecutionActionError({ taskId: previousTaskId, message });
      // 失败也可能已经持久化并发往引擎；定位已有记录，而不是把失败当作可自动重试。
      try {
        const snapshot = await window.agentx.getWorkspace();
        if (stillHere() && snapshot.tasks.some(task => task.taskId === request.taskId)) {
          workspace.setSelectedTaskId(request.taskId);
          setExecutionActionError({ taskId: request.taskId, message });
        }
      } catch { if (stillHere()) setExecutionActionError({ taskId: previousTaskId, message: `${message}；未能核对任务记录，请重读状态，不要重复提交。` }); }
    } finally {
      await Promise.all([workspace.load(), execution.load()]);
      submitLock.current = false; setSubmitting(false);
    }
  }

  async function supplement() {
    const task = currentExecution?.task;
    if (!task?.threadId || !task.turnId || !canSteer || !draft.trim() || steeringTaskId || execution.error) return;
    const text = draft, revision = draftRevision.current;
    setSteeringTaskId(task.taskId); setExecutionActionError(null); setSteerNotice(null);
    try {
      await window.agentx.steerExecution({ taskId: task.taskId, operationId: crypto.randomUUID(), threadId: task.threadId, turnId: task.turnId, text });
      setSteerNotice({ taskId: task.taskId, turnId: task.turnId, message: '补充要求已接收' });
      // 仅清除本次确已接收且没有再编辑的输入，切换会话也会推进草稿修订。
      if (draftRevision.current === revision) setDraft('');
    } catch (cause) {
      setExecutionActionError({ taskId: task.taskId, turnId: task.turnId, message: cause instanceof Error ? cause.message : '补充失败，请保留输入' });
    } finally { setSteeringTaskId(null); void execution.load(); }
  }
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
    const focused = document.activeElement;
    setView('workbench');
    requestAnimationFrame(() => {
      if (document.activeElement === focused || document.activeElement === document.body) input.current?.focus();
    });
  }

  function newSession() { selection.current.generation++; setExecutionActionError(null); workspace.setSelectedTaskId(null); openWorkbench(); }

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
    const focused = document.activeElement;
    setSidebarOpen(open => !open);
    requestAnimationFrame(() => {
      // 导航重挂载后恢复原操作位置，但不覆盖用户已经移走的新焦点。
      if (document.activeElement === focused || document.activeElement === document.body) sidebarToggle.current?.focus();
    });
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
    {workspace.taskMenu && <TaskMenu menu={workspace.taskMenu} onRename={workspace.startTaskEditing} onClose={workspace.closeTaskMenu} />}
    {workspace.editingTask && <TaskEditor task={workspace.editingTask} onSaved={() => void workspace.load()} onClose={workspace.closeTaskEditor} />}
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
      <div className={`workbench-layout${resultsOpen || outputItem ? ' has-results' : ''}`} hidden={view !== 'workbench'}>
      <main className={`welcome${selectedTask || currentExecution?.task || reconciliationTaskId ? ' execution-workbench' : ''}`}>
        <div className="welcome-heading">
          <div className="task-heading"><h1 title={selectedTask?.title}>{selectedTask?.title ?? '今天想完成什么工作？'}</h1>
            {selectedTask && <button className="icon-button" aria-label="会话操作" title="会话操作" aria-haspopup="menu"
              aria-expanded={workspace.taskMenu?.task.taskId === selectedTask.taskId}
              onClick={event => workspace.openTaskMenu(selectedTask, event.currentTarget)}>⋯</button>}
          </div>
          <p>{currentState ? currentState === 'stopping' ? '正在停止，等待引擎确认…' : taskStateLabel[currentState] : selectedTask ? taskStateLabel[selectedTask.executionState] : '用自然语言描述目标，在这里开始工作。'}</p>
          {canInspect && <button ref={resultsTrigger} className="secondary-button inspect-results" aria-label="查看文件改动" aria-expanded={resultsOpen} onClick={() => { setOutputSelection(null); setResultsTask(selectedTask!.taskId); }}>查看文件改动</button>}
        </div>
        {(selectedTask || currentExecution || reconciliationTaskId) && <div className="execution-transcript">
        {reconciliationTaskId && <ReconciliationNotice key={reconciliationTaskId} taskId={reconciliationTaskId} />}
        {history.loading && <p role="status" className="muted">正在读取会话历史…</p>}
        {history.error && <p role="alert" className="error-message">历史读取失败：{history.error} <button className="secondary-button" onClick={() => void history.load()}>重新读取历史</button></p>}
        {history.value && (history.loading || history.error || history.value.turns.at(-1)?.turnId !== selectedTask?.turnId) && <p className="muted">以下保留先前成功读取的历史，不代表当前轮已结束。</p>}
        {history.value && <HistoryTimeline history={history.value} onOpenOutput={openOutput} />}
        {currentExecution && !hasCurrentHistory && <ExecutionTimeline items={currentExecution.items} approvals={currentExecution.approvals} pending={pendingApprovals}
          inputText={currentExecution.inputText} onOpenOutput={openOutput}
          plan={currentExecution.plan} active={!!currentState && ['running', 'waitingApproval', 'waitingInput', 'stopping'].includes(currentState) && !execution.error}
          canAnswer={currentState === 'waitingApproval' && !execution.error && !stopping} onAnswer={(token, decision) => void answerApproval(token, decision)} />}
        </div>}
        {execution.error && <p role="alert" className="error-message">{execution.error} <button className="secondary-button" onClick={() => void execution.load()}>重读执行状态</button></p>}
        {(visibleExecutionError || currentExecution?.error) && <p role="alert" className="error-message">{visibleExecutionError || currentExecution?.error}</p>}
        <div className="location"><FolderIcon /><select aria-label="工作目录" value={workspace.selectedProjectId ?? ''} disabled={workspace.choosing || !workspace.snapshot}
          title={workspace.snapshot?.projects.find(project => project.projectId === workspace.selectedProjectId)?.directory}
          onChange={event => { if (event.target.value === 'choose-directory') void workspace.choose(); else { workspace.setSelectedTaskId(null); workspace.setSelectedProjectId(event.target.value || null); } }}>
          <option value="">未关联项目</option>
          {workspace.snapshot?.projects.map(project => <option key={project.projectId} value={project.projectId}>{project.displayName}</option>)}
          <option value="choose-directory">选择本地文件夹…</option>
        </select></div>
        <section className="composer" aria-label="任务输入">
          {canSteer && <div className="composer-supplement"><button className="supplement-button" aria-label="补充要求" title="补充要求（Enter）"
            disabled={!draft.trim() || !!steeringTaskId || !!execution.error} onClick={() => void supplement()}>{steeringTaskId ? '正在补充…' : '补充要求 (Enter)'}</button></div>}
          <label className="sr-only" htmlFor="task-draft">任务要求</label>
          <textarea id="task-draft" ref={input} value={draft} disabled={draftState.loading} onChange={event => { draftRevision.current++; setDraft(event.target.value); }}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
              if (event.ctrlKey && !event.altKey && !event.metaKey) {
                event.preventDefault();
                const textarea = event.currentTarget;
                const start = textarea.selectionStart, end = textarea.selectionEnd;
                const text = textarea.value;
                draftRevision.current++;
                // 换行和光标属于同一次按键；延迟到下一帧会覆盖用户后来的输入或选择。
                flushSync(() => setDraft(`${text.slice(0, start)}\n${text.slice(end)}`));
                textarea.setSelectionRange(start + 1, start + 1);
                return;
              }
              if (event.shiftKey || event.altKey || event.metaKey) return;
              event.preventDefault();
              if (canSteer) void supplement();
              else if (!blockedReason && !showStop) void sendTurn();
            }}
            placeholder="描述你想完成的工作…" title="Enter 发送，Ctrl+Enter 换行" />
          <div className="composer-toolbar">
            <span className="muted">请求批准</span>
            {currentExecution?.task && !canInspect ? <span className="model-state">{FLASH_MODEL_ID} · 本轮</span>
              : <ModelPicker visible={view === 'workbench'} onSettingsChange={setModelConfiguration} openSettings={() => { setSettingsGroup('models'); setView('settings'); }} />}
            <button className="send-button" aria-label={showStop ? '停止' : '发送'} aria-describedby="send-unavailable" title={showStop ? '停止当前轮次' : blockedReason || '发送任务'}
              disabled={showStop ? stopping || currentState === 'stopping' || !!execution.error : !!blockedReason} onClick={() => showStop ? void stopExecution() : void sendTurn()}>
              {showStop ? <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
                : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 20V4m-7 7 7-7 7 7" /></svg>}
            </button>
          </div>
        </section>
        {draftState.error ? <p role="alert" className="error-message">{draftState.error}；当前输入不会自动丢弃。<button className="secondary-button" onClick={draftState.retry}>重试草稿保存或读取</button></p>
          : <p role="status" className="muted">{draftState.loading ? '正在读取草稿…' : draftState.saving ? '正在保存草稿…' : '草稿已保存'}</p>}
        {steerNotice?.taskId === workspace.selectedTaskId && steerNotice.turnId === currentExecution?.task?.turnId && <p role="status" className="muted">{steerNotice.message}</p>}
        <p id="send-unavailable" role="note" className={selectedProject?.directoryState === 'unavailable' ? 'error-message' : 'muted'}>{selectedProject?.directoryState === 'unavailable'
          ? `工作目录不可用：${selectedProject.directoryError}。不能在此目录开始新执行，原会话关联仍保留。` : currentExecution && !canInspect ? '本轮沿用已提交的模型与权限。停止请求需等待引擎确认，已发生的修改不会自动撤销。' : blockedReason || (selectedTask ? '将在原会话中开始新一轮，保留先前历史；这不是旧进程的断点续跑。' : '将使用选定项目与 Flash 开始工作。')}</p>
        {busyTask && busyTask.taskId !== workspace.selectedTaskId && <button className="secondary-button" onClick={() => {
          workspace.setSelectedProjectId(busyTask.projectId); workspace.setSelectedTaskId(busyTask.taskId);
        }}>查看活动或待核对任务</button>}
      </main>
      {resultsOpen && selectedTask?.turnId && <ResultsPanel key={`${selectedTask.taskId}:${selectedTask.turnId}`} taskId={selectedTask.taskId} turnId={selectedTask.turnId}
        onClose={() => { setResultsTask(null); resultsTrigger.current?.focus(); }} />}
      {outputItem && <OutputPanel key={`${outputSelection!.taskId}:${outputItem.threadId}:${outputItem.turnId}:${outputItem.itemId}`} item={outputItem}
        active={!hasCurrentHistory && outputItem.turnId === currentExecution?.task?.turnId && !execution.error && showStop}
        onClose={() => { setOutputSelection(null); if (outputTrigger.current?.isConnected) outputTrigger.current.focus(); else input.current?.focus(); }} />}
      </div>
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
          {view === 'settings' && settingsGroup === 'models' && <ModelSettings executionState={execution.error || !execution.snapshot ? 'unavailable'
            : execution.snapshot.preparing ? 'preparing' : execution.snapshot.task?.executionState ?? (busyTask ? 'reconciling' : null)} />}
        </div>
      </main>
      <div className="read-status">
        {(!info || !preferences) && !error && <p role="status" className="muted">正在读取应用信息与本地偏好…</p>}
        {error && <div role="alert" className="error-message">{error} <button className="secondary-button" onClick={() => void readAppInfo()}>重试</button></div>}
      </div>
    </div>
    <ExitDialog />
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
