import type { ExecutionState } from '../../shared/contracts/projects';
import { useEffect, useState } from 'react';

export const taskStateLabel: Record<ExecutionState, string> = {
  idle: '尚未执行', submitting: '提交中', running: '正在运行', waitingApproval: '等待批准', waitingInput: '等待回答',
  stopping: '停止中', reconciling: '状态待核对', unconfirmed: '结果未确认', completed: '本轮已结束', failed: '本轮失败', interrupted: '本轮已中断',
};

export function TaskStatus({ state, lastActivityAt }: { state: ExecutionState; lastActivityAt: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => window.clearInterval(timer); }, []);
  const label = taskStateLabel[state];
  if (state === 'running' || state === 'submitting' || state === 'stopping') return <span role="img" aria-label={label} title={label} className="task-spinner" />;
  if (['idle', 'completed', 'failed', 'interrupted'].includes(state)) {
    const minutes = Math.max(0, Math.floor((now - Date.parse(lastActivityAt)) / 60000));
    const relative = minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes}分` : minutes < 1440 ? `${Math.floor(minutes / 60)}小时` : `${Math.floor(minutes / 1440)}天`;
    return <span className="task-state">{state === 'failed' && <span className="task-state-error" role="img" aria-label={label}>! </span>}<time dateTime={lastActivityAt} title={`${new Date(lastActivityAt).toLocaleString('zh-CN')} · ${label}`}>{relative}</time></span>;
  }
  return <span className={state === 'reconciling' || state === 'unconfirmed' ? 'task-state-error' : 'task-state'} role="img" aria-label={label} title={label}>
    {state === 'waitingApproval' ? '◇' : state === 'waitingInput' ? '?' : state === 'reconciling' || state === 'unconfirmed' ? '!' : label}
  </span>;
}
