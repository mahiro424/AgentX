import { useEffect, useRef, useState } from 'react';
import type { CommandItem } from '../../shared/contracts/execution';

export function OutputPanel({ item, active, onClose }: { item: CommandItem; active: boolean; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState(440);
  const [wrap, setWrap] = useState(true);
  const copyLock = useRef(false);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [copiedText, setCopiedText] = useState<string | null>(null);
  async function copy() {
    if (item.output === null || copyLock.current) return;
    const text = item.output;
    copyLock.current = true; setCopying(true); setCopyError(''); setCopiedText(null);
    try { await window.agentx.copyOutput(text); setCopiedText(text); }
    catch (cause) { setCopyError(cause instanceof Error ? cause.message : '剪贴板写入失败'); }
    finally { copyLock.current = false; setCopying(false); }
  }
  useEffect(() => { closeButton.current?.focus(); }, []);
  return <section className={`results-panel${expanded ? ' results-expanded' : ''}`} aria-label="执行输出" style={{ width }}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <header><h2>执行输出</h2><span className="muted">只读记录</span>
      <button className="icon-button" aria-label={expanded ? '还原输出面板' : '放大输出面板'} onClick={() => setExpanded(!expanded)}>{expanded ? '↙' : '↗'}</button>
      <button ref={closeButton} className="icon-button" aria-label="关闭输出面板" onClick={onClose}>×</button></header>
    {!expanded && <div className="results-divider" role="separator" aria-label="调整输出面板宽度" aria-orientation="vertical" tabIndex={0}
      aria-valuemin={360} aria-valuemax={640} aria-valuenow={width}
      onPointerDown={event => { event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setWidth(Math.max(360, Math.min(640, innerWidth - event.clientX))); }}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); setWidth(previous => event.key === 'Home' ? 360 : event.key === 'End' ? 640 : Math.max(360, Math.min(640, previous + (event.key === 'ArrowLeft' ? 16 : -16))));
      }} />}
    <div className="results-body command-output">
      <div className="output-toolbar"><button className="secondary-button" disabled={copying || item.output === null} onClick={() => void copy()}>{copying ? '正在复制…' : '复制输出'}</button>
        <span className="output-wrap">自动换行<button className="toggle-switch" role="switch" aria-label="自动换行" aria-checked={wrap} onClick={() => setWrap(!wrap)}><span /></button></span></div>
      {copyError && <p role="alert" className="error-message">复制失败：{copyError}。可以重试。</p>}
      {copiedText !== null && <p role="status" className="muted">{copiedText === item.output ? '输出已复制' : '已复制点击时的输出；之后有新的输出，请按需重新复制。'}</p>}
      <p>命令：<code>{item.command}</code></p><p>目录：{item.directory}</p>
      <p className={item.exitCode !== null && item.exitCode !== 0 ? 'error-message' : ''}>退出码：{item.exitCode ?? '尚未返回（不能视为成功）'}</p>
      <p className="muted">轮次：{item.turnId}<br />执行项：{item.itemId}</p>
      <p className="muted">引擎提供的合并输出，不单独推断 stdout / stderr。</p>
      <pre style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre', overflowX: 'auto' }}>{item.output ?? '尚无命令输出记录'}</pre>
      {item.output === '' && <p className="muted">引擎返回空输出</p>}
      <p className="muted">{item.status === 'running' ? active ? '命令进行中' : '最后记录：进行中（未核对）'
        : ({ completed: '命令已结束', failed: '命令失败', declined: '命令已拒绝' })[item.status]} · 耗时：{item.durationMs === null ? '尚未返回' : `${item.durationMs} ms`}</p>
    </div>
  </section>;
}
