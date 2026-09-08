import type { ApprovalItem, ExecutionItem } from '../../shared/contracts/execution';

export function ApprovalCard({ approval, item, disabled, onAnswer }: {
  approval: ApprovalItem; item?: ExecutionItem; disabled: boolean; onAnswer: (token: string, decision: 'accept' | 'decline') => void;
}) {
  const unavailable = disabled || approval.status !== 'pending';
  return <section className="approval-card" role="group" aria-label={`审批请求：${approval.itemId}`}>
    <h2>{approval.kind === 'fileChange' ? '请求修改文件' : approval.kind === 'writeStdin' ? '请求向运行中的命令输入内容' : '请求运行命令'}</h2>
    {approval.reason && <p>{approval.reason}</p>}
    {approval.command !== null && <pre>{approval.command}</pre>}
    {approval.cwd && <p>工作目录：{approval.cwd}</p>}
    {approval.network && <p>网络目标：{approval.network.host} · {approval.network.protocol}</p>}
    {item?.kind === 'fileChange' && item.changes.map((change, index) => <details key={index}><summary>{change.path} · {change.operation}</summary><pre>{change.diff}</pre></details>)}
    {approval.kind === 'fileChange' && item?.kind !== 'fileChange' && <p className="muted">引擎尚未提供文件变化详情，请先核对请求范围。</p>}
    {approval.grantRoot && <p>引擎附带目录说明：{approval.grantRoot}</p>}
    <p className="muted">仅回答本次请求，不授予后续操作自动批准权限。执行结果另行显示。</p>
    <div className="approval-actions"><span className="muted">{approval.status === 'resolved' ? '请求已解决' : approval.status === 'stale' ? '请求已失效' : disabled || approval.status === 'responding' ? '当前不可重复回答' : '等待你批准'}</span>
      <button className="secondary-button" disabled={unavailable} onClick={() => onAnswer(approval.approvalToken, 'decline')}>拒绝</button>
      <button className="primary-button" disabled={unavailable} onClick={() => onAnswer(approval.approvalToken, 'accept')}>允许本次</button>
    </div>
  </section>;
}
