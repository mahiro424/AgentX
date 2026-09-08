import { useEffect, useRef, useState } from 'react';
import type { ExitAnswer, ExitSnapshot } from '../../shared/contracts/lifecycle';

export function ExitDialog() {
  const [snapshot, setSnapshot] = useState<ExitSnapshot>({ state: 'idle' });
  const [error, setError] = useState('');
  const [answering, setAnswering] = useState(false);
  const answeringRef = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let generation = 0, alive = true;
    const load = async () => {
      const request = ++generation;
      try {
        const value = await window.agentx.getExitState();
        if (alive && request === generation) { setSnapshot(value); setError(''); }
      } catch (cause) {
        if (alive && request === generation) setError(cause instanceof Error ? cause.message : '退出状态读取失败，未确认可以退出');
      }
    };
    const unsubscribe = window.agentx.onExitChanged(() => { void load(); });
    void load();
    return () => { alive = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    if (snapshot.state !== 'idle' && dialog.current && !dialog.current.open) {
      dialog.current.showModal(); cancel.current?.focus();
    }
  }, [snapshot.state]);
  async function answer(decision: ExitAnswer['decision']) {
    if (snapshot.state === 'idle' || snapshot.state === 'stopping' || answeringRef.current) return;
    answeringRef.current = true; setAnswering(true); setError('');
    try { await window.agentx.answerExit({ requestId: snapshot.requestId, decision }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '退出选择未送达，请保留当前状态'); }
    finally { answeringRef.current = false; setAnswering(false); }
  }
  if (snapshot.state === 'idle') return error ? <p role="alert" className="error-message">{error}</p> : null;
  const stopping = snapshot.state === 'stopping';
  return <dialog ref={dialog} className="exit-dialog" aria-labelledby="exit-heading" aria-describedby="exit-description"
    onCancel={event => { event.preventDefault(); if (!stopping) void answer('cancel'); }}>
    <header><h2 id="exit-heading">还有执行未确认结束</h2></header>
    <p id="exit-description">保留到托盘不会确认执行结束；退出应用会先停止并核对。</p>
    {stopping && <p role="status">正在停止，等待执行结果确认。轮次与后台终端核对完成后才会退出。</p>}
    {snapshot.error && <p role="alert" className="error-message">{snapshot.error}</p>}
    {error && <p role="alert" className="error-message">{error}</p>}
    <footer>
      <button ref={cancel} className="secondary-button" disabled={answering || stopping} onClick={() => void answer('cancel')}>取消</button>
      <button className="secondary-button" disabled={answering || stopping} onClick={() => void answer('tray')}>保留到托盘</button>
      <button className="primary-button" disabled={answering || stopping} onClick={() => void answer('stop')}>{stopping ? '停止中…' : '停止后退出'}</button>
    </footer>
    <p className="muted">若无法确认停止，继续显示未确认状态。</p>
  </dialog>;
}
