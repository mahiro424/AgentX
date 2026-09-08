import type { ExecutionItem, ApprovalItem, ExecutionPlan } from '../../shared/contracts/execution';
import { ApprovalCard } from './ApprovalCard';

const labels = { running: '进行中', completed: '已结束', failed: '失败', declined: '已拒绝' };

export function ExecutionTimeline({ items, approvals, pending, canAnswer, onAnswer, plan, active, inputText }: { items: ExecutionItem[]; approvals: ApprovalItem[]; plan?: ExecutionPlan; active: boolean; inputText?: string;
  pending: Set<string>; canAnswer: boolean; onAnswer: (token: string, decision: 'accept' | 'decline') => void }) {
  const card = (approval: ApprovalItem) => <ApprovalCard key={approval.approvalToken} approval={approval}
    item={items.find(item => item.itemId === approval.itemId)} disabled={!canAnswer || pending.has(approval.approvalToken)} onAnswer={onAnswer} />;
  return <section className="execution-timeline" aria-label="执行过程">
    {inputText !== undefined && <section className="execution-message execution-user-message" aria-label="已提交的要求">{inputText}</section>}
    {plan && <details className="execution-tool" aria-label="引擎计划" open>
      <summary><span>计划 · {plan.plan.length} 步</span><span className="muted">{active ? '引擎更新' : '最后已知计划'}</span></summary>
      {plan.explanation && <p>{plan.explanation}</p>}
      {!active && <p className="muted">以下保留最后一次计划更新，不代表尚未完成的步骤仍在运行。</p>}
      <ol>{plan.plan.map((step, index) => <li key={index}><span>{step.step}</span> <span className="muted">· {step.status === 'completed' ? '已完成'
        : step.status === 'pending' ? '待执行' : active ? '进行中' : '最后记录：进行中'}</span></li>)}</ol>
    </details>}
    {items.map(item => <div key={item.itemId}>{item.kind === 'message'
      ? <p className="execution-message" key={item.itemId}>{item.text}</p>
      : item.kind === 'command' ? <details className="execution-tool" key={item.itemId}>
        <summary><span>{item.command}</span><span className={item.status === 'failed' ? 'error-message' : 'muted'}>{labels[item.status]}</span></summary>
        <p className="muted">目录：{item.directory}</p>
        <pre>{item.output ?? '尚无命令输出'}</pre>
        <p className="muted">退出码：{item.exitCode ?? '尚未返回'} · 耗时：{item.durationMs === null ? '尚未返回' : `${item.durationMs} ms`}</p>
      </details> : <details className="execution-tool" key={item.itemId}>
        <summary><span>文件修改 · {item.changes.length} 项</span><span className={item.status === 'failed' ? 'error-message' : 'muted'}>{labels[item.status]}</span></summary>
        <p className="muted">以下为引擎报告，实际文件变化尚待核对。</p>
        {item.changes.map((change, index) => <div key={`${change.path}-${index}`}><p>{change.path} · {change.operation}</p>
          {change.movePath && <p>移动到：{change.movePath}</p>}<pre>{change.diff}</pre></div>)}
      </details>}{approvals.filter(approval => approval.itemId === item.itemId).map(card)}</div>)}
    {approvals.filter(approval => !items.some(item => item.itemId === approval.itemId)).map(card)}
  </section>;
}
