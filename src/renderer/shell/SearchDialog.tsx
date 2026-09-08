import { useEffect, useRef, useState } from 'react';
import type { ProjectSummary } from '../../shared/contracts/projects';
import type { SearchSnippet, TaskSearchRequest, TaskSearchResult, TaskSearchSnapshot, SearchIndexState } from '../../shared/contracts/search';

export function SearchIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="10.5" cy="10.5" r="7" /><path d="m16 16 5 5" /></svg>;
}

function Highlight({ snippet }: { snippet: SearchSnippet }) {
  let start = 0;
  const parts = snippet.ranges.map(([from, to]) => {
    const text = <span key={from}>{snippet.text.slice(start, from)}<mark>{snippet.text.slice(from, to)}</mark></span>;
    start = to; return text;
  });
  return <>{parts}{snippet.text.slice(start)}</>;
}

export function SearchDialog({ open, projects, onClose, onOpen }: { open: boolean; projects: ProjectSummary[];
  onClose: () => void; onOpen: (result: TaskSearchResult) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLElement | null>(null), composing = useRef(false), sequence = useRef(0), opening = useRef(false);
  const [request, setRequest] = useState<TaskSearchRequest>({ query: '', scope: 'all', projectId: null, includeArchived: false });
  const currentRequest = useRef(request); currentRequest.current = request;
  const [snapshot, setSnapshot] = useState<TaskSearchSnapshot | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [openingId, setOpeningId] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [indexState, setIndexState] = useState<SearchIndexState | null>(null), [indexError, setIndexError] = useState('');
  const rebuilding = useRef(false);
  const restoring = useRef(false);
  const [restoringId, setRestoringId] = useState<string | null>(null), [notice, setNotice] = useState('');

  useEffect(() => {
    if (open) {
      trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.current?.showModal(); input.current?.focus();
    } else {
      dialog.current?.close();
      if (trigger.current?.isConnected) trigger.current.focus();
      trigger.current = null;
    }
  }, [open]);

  async function query() {
    const current = ++sequence.current;
    setLoading(true); setError('');
    try {
      const value = await window.agentx.searchTasks(currentRequest.current);
      if (current === sequence.current) { setSnapshot(value); setActive(0); }
    } catch (cause) {
      if (current === sequence.current) setError(cause instanceof Error ? cause.message : '搜索失败，查询与已有结果仍保留');
    } finally { if (current === sequence.current) setLoading(false); }
  }
  useEffect(() => {
    if (!open) return;
    void query();
    const unsubscribe = window.agentx.onWorkspaceChanged(() => void query());
    return () => { sequence.current++; unsubscribe(); };
  }, [open, request]);
  useEffect(() => {
    if (!open) return;
    let current = 0, cancelled = false;
    const refresh = async () => {
      const revision = ++current;
      try {
        const state = await window.agentx.getSearchIndexState();
        if (!cancelled && revision === current) { setIndexState(state); setIndexError(''); }
      } catch (cause) { if (!cancelled && revision === current) setIndexError(cause instanceof Error ? cause.message : '索引进度读取失败'); }
    };
    void refresh();
    const unsubscribe = window.agentx.onSearchIndexChanged(() => { void refresh(); void query(); });
    return () => { cancelled = true; unsubscribe(); };
  }, [open, request]);
  async function rebuild() {
    if (rebuilding.current) return;
    rebuilding.current = true; setIndexError('');
    try { await window.agentx.rebuildSearchIndex(); }
    catch (cause) { setIndexError(cause instanceof Error ? cause.message : '索引重建失败，原结果仍保留'); }
    finally { rebuilding.current = false; }
  }
  async function restore(result: TaskSearchResult) {
    if (restoring.current || opening.current) return;
    restoring.current = true; setRestoringId(result.taskId); setNotice(''); setError('');
    try {
      const workspace = await window.agentx.getWorkspace();
      const task = workspace.tasks.find(task => task.taskId === result.taskId);
      if (!task) throw new Error('原会话不可读取，未恢复');
      if (task.archivedAt) await window.agentx.setTaskArchived({ taskId: task.taskId, operationId: crypto.randomUUID(), archived: false, expectedRevision: task.organizationRevision });
      // 只合并确认的组织字段；列表查询失败不能诱导重复恢复，也不触碰执行历史。
      setSnapshot(previous => previous ? { ...previous, results: previous.results.map(value => value.taskId === task.taskId ? { ...value, archived: false } : value) } : previous);
      setNotice('会话已恢复，没有开始执行；若列表查询失败，请重试搜索。');
      await query();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '恢复会话失败，原结果仍保留'); }
    finally { restoring.current = false; setRestoringId(null); }
  }

  function close() { if (!opening.current && !composing.current) onClose(); }
  async function select(result: TaskSearchResult) {
    if (opening.current || restoring.current || loading || error || composing.current) return;
    opening.current = true; setOpeningId(result.taskId); setError('');
    try { await onOpen(result); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '打开命中失败，原结果仍保留'); }
    finally { opening.current = false; setOpeningId(null); }
  }
  function move(direction: number) {
    if (!snapshot?.results.length || loading || error) return;
    const next = Math.max(0, Math.min(snapshot.results.length - 1, active + direction));
    setActive(next);
    dialog.current?.querySelector<HTMLElement>(`[data-search-index="${next}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  return <dialog ref={dialog} className="search-dialog" aria-label="搜索会话" onCancel={event => { event.preventDefault(); close(); }}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || composing.current) return;
      // 下拉框和操作按钮保留自己的键盘语义，输入框与结果列表共享选中位置。
      if (event.target !== input.current && !(event.target as HTMLElement).hasAttribute('data-search-index')) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); move(event.key === 'ArrowDown' ? 1 : -1); }
      if (event.key === 'Enter') { event.preventDefault(); const result = snapshot?.results[active]; if (result) void select(result); }
    }}>
    <header><div className="search-input"><SearchIcon /><input ref={input} aria-label="搜索会话内容" value={request.query} placeholder="搜索会话"
      maxLength={500} onChange={event => setRequest(value => ({ ...value, query: event.target.value }))}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} />
      {request.query && <button className="icon-button" aria-label="清空搜索" onClick={() => { setRequest(value => ({ ...value, query: '' })); input.current?.focus(); }}>×</button>}</div>
      <button className="diagnostic-button" aria-label="关闭搜索" disabled={!!openingId} onClick={close}>Esc</button></header>
    <div className="search-filters">
      <select aria-label="搜索范围" value={request.scope} onChange={event => setRequest(value => ({ ...value, scope: event.target.value as TaskSearchRequest['scope'] }))}>
        <option value="all">标题和正文</option><option value="title">仅标题</option><option value="body">仅正文</option></select>
      <select aria-label="搜索项目" value={request.projectId ?? ''} onChange={event => setRequest(value => ({ ...value, projectId: event.target.value || null }))}>
        <option value="">所有项目</option>{projects.map(project => <option key={project.projectId} value={project.projectId}>{project.displayName}</option>)}</select>
      <label><input type="checkbox" checked={request.includeArchived} onChange={event => setRequest(value => ({ ...value, includeArchived: event.target.checked }))} />包含已归档</label>
    </div>
    <p className="search-count" role="status">{openingId ? '正在核验命中来源…' : loading ? '正在搜索…' : `${snapshot?.results.length ?? 0} 个会话${request.query.trim() ? '' : ' · 最近活动'}`}</p>
    {error && <div className="search-error error-message" role="alert">{error}<p>查询、筛选与原结果仍保留，以下结果尚未重新核对。</p><button className="secondary-button" onClick={() => void query()}>重试搜索</button></div>}
    <div className="search-results" role="group" aria-label="搜索结果" aria-busy={loading}>
      {snapshot?.results.map((result, index) => <div key={result.taskId} className="search-result-row"><button data-search-index={index} className="search-result"
        aria-label={`打开会话：${result.title}`} aria-current={index === active ? true : undefined} disabled={loading || !!error || !!openingId || !!restoringId}
        onFocus={() => setActive(index)} onMouseEnter={() => setActive(index)} onClick={() => void select(result)}>
        <span className="search-result-heading"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6" /></svg><strong>{result.match === 'title' && result.snippet ? <Highlight snippet={result.snippet} /> : result.title}</strong>
          <span className="muted">{result.projectName} · <time dateTime={result.lastActivityAt}>{new Date(result.lastActivityAt).toLocaleDateString('zh-CN')}</time></span></span>
        {result.match === 'body' && result.snippet && <span className="search-snippet"><Highlight snippet={result.snippet} /></span>}
        <span className="search-result-meta muted">{result.archived && <span>已归档 · </span>}{result.match === 'body' ? '正文命中 · 定位到消息' : '打开会话'}{result.sourceError && <span className="error-message"> · 原历史待核验：{result.sourceError}</span>}</span>
      </button>{result.archived && <button className="diagnostic-button search-restore" aria-label={`恢复会话：${result.title}`}
        disabled={loading || !!error || !!openingId || !!restoringId} onClick={() => void restore(result)}>{restoringId === result.taskId ? '正在恢复…' : '恢复'}</button>}</div>)}
      {!loading && !error && snapshot?.results.length === 0 && <p className="muted search-empty">未找到匹配会话。{snapshot.coverage.issues.length > 0 ? '部分历史尚未可搜索，不能据此判断全文没有匹配。' : '可以更换关键词或筛选条件。'}</p>}
    </div>
    <div className="search-coverage">
      {notice && <p role="status">{notice}</p>}
      <div className="search-index-actions">{indexState?.running ? <span role="status">正在建立索引 {indexState.processed}/{indexState.total} · 当前结果可能不完整</span> : <span>正文索引来自可见历史</span>}
        <button className="diagnostic-button" disabled={indexState?.running || !!openingId} onClick={() => void rebuild()}>重建索引</button></div>
      {(indexError || indexState?.error) && <p role="alert" className="error-message">{indexError || indexState?.error}</p>}
      {snapshot && <details><summary>已覆盖 {snapshot.coverage.coveredTasks}/{snapshot.coverage.totalTasks} 个会话{snapshot.coverage.issues.length ? ' · 当前结果可能不完整' : ''}</summary>
        {snapshot.coverage.issues.map(issue => <p key={issue.taskId}>{issue.title}：{issue.reason}</p>)}</details>}
    </div>
    <footer><span><button className="secondary-button" aria-label="上一条搜索结果" disabled={!active || loading || !!error} onClick={() => move(-1)}>↑</button> <button className="secondary-button" aria-label="下一条搜索结果" disabled={!snapshot || active >= snapshot.results.length - 1 || loading || !!error} onClick={() => move(1)}>↓</button></span><span>Enter　打开命中位置　　Esc　关闭</span></footer>
  </dialog>;
}
