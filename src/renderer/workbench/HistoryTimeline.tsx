import type { TaskHistory } from '../../shared/contracts/history';
import { ExecutionTimeline } from './ExecutionTimeline';

const labels = { completed: '已完成', interrupted: '已中断', failed: '失败', inProgress: '需核对状态' };

export function HistoryTimeline({ history }: { history: TaskHistory }) {
  return <section className="execution-timeline" aria-label="会话历史">
    {history.turns.map((turn, index) => <section key={turn.turnId} aria-label={`第 ${index + 1} 轮`}>
      <p className="muted" title={turn.turnId}>第 {index + 1} 轮 · {labels[turn.status]}</p>
      {turn.status !== 'completed' && <p className="muted">以下为本轮已有记录，不代表任务已全部完成。</p>}
      <ExecutionTimeline items={turn.items} approvals={[]} pending={new Set()} canAnswer={false} active={false} onAnswer={() => {}} />
      {turn.unrepresentedItemTypes.some(type => type !== 'reasoning') && <p className="muted">部分执行项尚不支持展示：{[...new Set(turn.unrepresentedItemTypes.filter(type => type !== 'reasoning'))].join('、')}</p>}
    </section>)}
  </section>;
}
