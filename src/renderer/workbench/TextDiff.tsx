import { useMemo } from 'react';
import { diffLines } from 'diff';
import type { ResultChange } from '../../shared/contracts/results';

export function TextDiff({ change }: { change: ResultChange }) {
  const comparison = useMemo(() => {
    if (change.before?.text === null || change.after?.text === null) return { error: '二进制或非 UTF-8 文件，不提供文本差异' };
    const before = change.before?.text ?? '', after = change.after?.text ?? '';
    if (before.length + after.length > 200000 || before.split('\n').length + after.split('\n').length > 5000) return { error: '文本超过行级比较上限；可展开下方原文核对' };
    const parts = diffLines(before, after, { maxEditLength: 2000, timeout: 50 });
    if (!parts) return { error: '行级比较超过计算上限；可展开下方原文核对' };
    return { parts, before, after };
  }, [change]);
  if (comparison.error) return <p role="note">{comparison.error}</p>;
  let oldLine = 1, newLine = 1;
  const parts = comparison.parts!;
  return <section aria-label="只读文本差异" className="text-diff">
    <p><span className="test-passed">+{parts.reduce((sum, part) => sum + (part.added ? part.count : 0), 0)}</span>{' '}
      <span className="test-failed">-{parts.reduce((sum, part) => sum + (part.removed ? part.count : 0), 0)}</span> · 只读行级比较</p>
    <div className="diff-lines" tabIndex={0} aria-label="差异内容，可横向滚动">
      {parts.flatMap((part, partIndex) => {
        const lines = part.value.split('\n'); if (part.value.endsWith('\n')) lines.pop();
        return lines.map((line, index) => <div key={`${partIndex}:${index}`} className={part.added ? 'diff-added' : part.removed ? 'diff-removed' : 'diff-context'}>
          <span className="diff-number" aria-hidden="true">{part.added ? '' : oldLine++}</span><span className="diff-number" aria-hidden="true">{part.removed ? '' : newLine++}</span>
          <span className="diff-marker">{part.added ? '+' : part.removed ? '-' : ' '}</span><code>{line}</code>
        </div>);
      })}
    </div>
    {comparison.before && !comparison.before.endsWith('\n') && <p className="muted">原文末尾无换行</p>}
    {comparison.after && !comparison.after.endsWith('\n') && <p className="muted">当前文本末尾无换行</p>}
  </section>;
}
