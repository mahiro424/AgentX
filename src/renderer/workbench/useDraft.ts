import { useEffect, useRef, useState } from 'react';
import type { DraftScope } from '../../shared/contracts/drafts';

interface Entry {
  scope: DraftScope; text: string; savedText: string; revision: number | null;
  loading: boolean; saving: boolean; error: string;
}

export function useDraft(scope: DraftScope) {
  const entries = useRef(new Map<string, Entry>());
  const [, render] = useState(0);
  const refresh = () => render(value => value + 1);
  const key = JSON.stringify([scope.projectId, scope.taskId]);
  let entry = entries.current.get(key);
  if (!entry) {
    entry = { scope, text: '', savedText: '', revision: null, loading: false, saving: false, error: '' };
    entries.current.set(key, entry);
  }
  const current = entry;
  async function load(value: Entry) {
    if (value.loading || value.revision !== null) return;
    value.loading = true; value.error = ''; refresh();
    try {
      const saved = await window.agentx.getDraft(value.scope);
      value.text = saved.text; value.savedText = saved.text; value.revision = saved.revision;
    } catch (cause) { value.error = cause instanceof Error ? cause.message : '草稿读取失败'; }
    finally { value.loading = false; refresh(); }
  }
  async function persist(value: Entry) {
    if (value.saving || value.revision === null) return;
    value.saving = true; value.error = ''; refresh();
    try {
      // 每个输入现场单独串行写入；写入期间的新编辑在下一次迭代保存。
      while (value.text !== value.savedText) {
        const text = value.text;
        const saved = await window.agentx.saveDraft({ ...value.scope, text, expectedRevision: value.revision });
        value.revision = saved.revision; value.savedText = text;
      }
    } catch (cause) { value.error = cause instanceof Error ? cause.message : '草稿保存失败，输入仍保留在窗口中'; }
    finally { value.saving = false; refresh(); }
  }
  useEffect(() => { void load(current); }, [key]);
  return {
    text: current.text, loading: current.revision === null, saving: current.saving, error: current.error,
    latestText: () => current.text,
    setText(text: string) {
      if (current.revision === null) return;
      current.text = text; refresh();
      if (!current.error) void persist(current);
    },
    retry() { if (current.revision === null) void load(current); else void persist(current); },
    // 仅供首次提交确认后新建的任务：没有历史草稿，CAS=0 不会覆盖并发写入。
    seedNewTask(target: DraftScope, text: string) {
      const targetKey = JSON.stringify([target.projectId, target.taskId]);
      if (entries.current.has(targetKey)) return;
      const value: Entry = { scope: target, text, savedText: '', revision: 0, loading: false, saving: false, error: '' };
      entries.current.set(targetKey, value); void persist(value);
    },
  };
}
