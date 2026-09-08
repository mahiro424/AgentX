import { useEffect, useRef, useState } from 'react';
import type { TaskResults } from '../../shared/contracts/results';
import { TextDiff } from './TextDiff';

export function ResultsPanel({ taskId, turnId, onClose }: { taskId: string; turnId: string; onClose: () => void }) {
  const sequence = useRef(0);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [value, setValue] = useState<TaskResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState(440);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const selected = value?.changes.find(change => change.path === selectedPath);
  async function load() {
    const current = ++sequence.current;
    setLoading(true); setError('');
    try {
      const result = await window.agentx.getTaskResults({ taskId, turnId });
      if (result.taskId !== taskId || result.turnId !== turnId) throw new Error('文件结果归属不匹配');
      if (current === sequence.current) setValue(result);
    } catch (cause) {
      if (current === sequence.current) setError(cause instanceof Error ? cause.message : '文件结果读取失败');
    } finally { if (current === sequence.current) setLoading(false); }
  }
  useEffect(() => { closeButton.current?.focus(); void load(); return () => { sequence.current++; }; }, [taskId, turnId]);
  return <section className={`results-panel${expanded ? ' results-expanded' : ''}`} aria-label="文件改动" style={{ width }}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <header><h2>改动</h2><button className="icon-button" aria-label={expanded ? '还原改动面板' : '放大改动面板'} onClick={() => setExpanded(!expanded)}>{expanded ? '↙' : '↗'}</button>
      <button ref={closeButton} className="icon-button" aria-label="关闭改动面板" onClick={onClose}>×</button></header>
    {!expanded && <div className="results-divider" role="separator" aria-label="调整改动面板宽度" aria-orientation="vertical" tabIndex={0}
      aria-valuemin={360} aria-valuemax={640} aria-valuenow={width}
      onPointerDown={event => { event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setWidth(Math.max(360, Math.min(640, innerWidth - event.clientX))); }}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); setWidth(previous => event.key === 'Home' ? 360 : event.key === 'End' ? 640 : Math.max(360, Math.min(640, previous + (event.key === 'ArrowLeft' ? 16 : -16))));
      }} />}
    <div className="results-body">
      <div className="results-scope"><strong>本轮开始后</strong><button className="icon-button" aria-label="重新检查文件改动" disabled={loading} onClick={() => void load()}>↻</button></div>
      {loading && <p role="status" className="muted">正在检查实际文件变化…</p>}
      {error && <p role="alert" className="error-message">{error}。未确认本次检查；可以重新检查，草稿保留。</p>}
      {value && <>
        {(loading || error) && <p role="note">以下保留上次成功检查，当前文件状态尚未确认。</p>}
        <p className="muted">比较基线：本轮开始 {new Date(value.baselineAt).toLocaleString()} → 当前检查 {new Date(value.observedAt).toLocaleString()}</p>
        <p className="muted">轮次：{value.turnId}<br />目录：{value.directory}</p>
        <p className="muted">变化可能包含外部人工修改，不全部归因于 Agent；这不是轮次结束时的原子快照。</p>
        <details><summary>检查范围与原有改动</summary><p>排除：{value.excludedNames.join('、')}。单文件上限 1 MiB，累计读取 32 MiB，最多 10000 条目 / 64 层。</p>
          {value.baselineGit.status === 'available' ? <><p>本轮开始前已有 Git 改动：{value.baselineGit.changes.length} 项</p>
            <ul>{value.baselineGit.changes.map(change => <li key={change.path}>{change.path} · {change.index}{change.worktree}</li>)}</ul></>
            : <p>{value.baselineGit.message}</p>}</details>
        {!value.complete && <div role="note"><p>检查范围不完整，未覆盖的文件不能判定为没有变化：</p>
          <ul>{value.issues.map((issue, index) => <li key={index}>{issue.path || '工作区'} · {({ unreadable: '无法读取', link: '链接未遍历', limit: '超过检查上限', changedDuringRead: '读取期间变化' })[issue.reason]}{issue.code && `（${issue.code}）`}</li>)}</ul></div>}
        {!loading && !error && value.complete && value.changes.length === 0 && <p role="status">检查范围内没有文件变化</p>}
        {value.changes.length > 0 && <ul className="result-files" aria-label="实际文件变化">{value.changes.map(change => {
          const label = ({ add: '新增', update: '修改', delete: '删除' })[change.operation];
          return <li key={change.path}><button aria-label={`${label} ${change.path}`} aria-pressed={selectedPath === change.path} onClick={() => setSelectedPath(change.path)}>
            <span>{change.path}</span><span className={change.operation === 'delete' ? 'test-failed' : 'test-passed'}>{label}</span></button></li>;
        })}</ul>}
        {selected && <section className="result-file-preview" aria-label="文件原文">
          <h3>{selected.path}</h3><p className="muted">只读 · 轮次 {value.turnId} · {value.directory}/{selected.path}</p>
          <TextDiff change={selected} />
          <details><summary>本轮开始时的原文</summary><pre>{selected.before ? selected.before.text ?? '二进制或非 UTF-8 文件，不提供文本预览' : '本轮开始时不存在此文件'}</pre></details>
          <details><summary>当前检查时的原文</summary><pre>{selected.after ? selected.after.text ?? '二进制或非 UTF-8 文件，不提供文本预览' : '当前文件已删除'}</pre></details>
        </section>}
      </>}
    </div>
  </section>;
}
