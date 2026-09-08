import { useEffect, useRef, useState } from 'react';
import type { ReconciliationSnapshot } from '../../shared/contracts/reconciliation';
import { HistoryTimeline } from './HistoryTimeline';

const processLabels = { sameProcess: '仍发现同一引擎进程', notFound: '未发现记录中的根进程', pidReused: '该 PID 已属于其他进程，不会操作它',
  released: '已有完整回收记录', unavailable: '进程身份未能核实' };
const phaseLabels = { prepared: '已保存，尚未确认派发', sent: '已发出，尚未确认应答', acknowledged: '已确认轮次关联', unknown: '发送结果待核对', settled: '本轮已结束' };
const turnLabels = { completed: '已完成', failed: '失败', interrupted: '已中断', inProgress: '历史记录仍为进行中' };

export function ReconciliationNotice({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<ReconciliationSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true), locked = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function load() {
    if (locked.current) return;
    locked.current = true; setLoading(true); setError('');
    try {
      const result = await window.agentx.getReconciliation({ taskId });
      if (result.taskId !== taskId) throw new Error('核对结果归属不一致，不能显示为当前任务');
      if (alive.current) setValue(result);
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '状态核对失败，请保留记录'); }
    finally { locked.current = false; if (alive.current) setLoading(false); }
  }
  return <section className="reconciliation-notice" aria-label="执行状态核对">
    <div className="reconciliation-heading"><span className="reconciliation-icon" aria-hidden="true">!</span>
      <strong>{loading ? '状态核对中' : '执行状态待核对'}</strong></div>
    <p className="muted">连接或回收结果尚未确认。核对历史与进程记录，不会重复提交。</p>
    <button className="diagnostic-button" aria-expanded={open} onClick={() => {
      setOpen(!open); if (!open && !value) void load();
    }}>{open ? '收起诊断' : '查看诊断'}</button>
    {open && <section className="reconciliation-details" aria-label="状态核对详情">
      {loading && <p role="status">正在读取发送意图、进程身份和公开历史…</p>}
      {error && <p role="alert" className="error-message">{error}</p>}
      {value && <>
        <p>核对对象：{value.title}</p>
        {(error || loading) && <p className="muted">以下保留上次核对事实，不代表当前状态。</p>}
        <p className="muted">核对开始时间：{new Date(value.observedAt).toLocaleString()}</p>
        {value.stale && <p role="alert" className="error-message">读取期间产品记录已变化，请重新核对；本次结果不是最新状态。</p>}
        <h3>发送记录</h3>
        {!value.intents.length && <p>没有已保存的发送意图，不能据此认领某次执行。</p>}
        <ul>{value.intents.map(intent => <li key={intent.operationId}><span>{phaseLabels[intent.phase]}</span><code>{intent.operationId}</code>
          <span>{intent.turnId ? `轮次：${intent.turnId}` : '尚无已确认轮次'}</span></li>)}</ul>
        <h3>进程与后台</h3>
        {!value.processes.length && <p>没有进程归属记录，不能确认是否存在遗留执行。</p>}
        <ul>{value.processes.map(process => <li key={process.leaseId}><span>{processLabels[process.state]}</span>
          <span>{process.background === 'released' ? '后台回收已有记录' : '后台工作是否全部结束仍未确认'}</span>
          {process.rootClosedAt && <span>根进程关闭记录：{new Date(process.rootClosedAt).toLocaleString()}</span>}
          {process.error && <span role="alert" className="error-message">{process.error}</span>}</li>)}</ul>
        <h3>公开历史</h3>
        {value.matchedTurnStatus && <p>精确关联轮次：{turnLabels[value.matchedTurnStatus]}；这不代表后台工作均已结束。</p>}
        {value.bindingIssue && <p role="alert" className="error-message">{value.bindingIssue}</p>}
        {value.historyError && <p role="alert" className="error-message">{value.historyError}</p>}
        {value.history && <details><summary>查看已读取的历史记录</summary><HistoryTimeline history={value.history} /></details>}
      </>}
      <p className="muted">核对不会重新执行任务或自动解除占用。根进程消失不代表全部后台工作已停止。</p>
      <button className="secondary-button" disabled={loading} onClick={() => void load()}>重新核对</button>
    </section>}
  </section>;
}
