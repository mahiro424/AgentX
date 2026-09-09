import { useEffect, useRef, useState } from 'react';
import type { DraftScope } from '../../shared/contracts/drafts';
import type { MaterialRecord } from '../../shared/contracts/materials';

interface Entry {
  scope: DraftScope; text: string; savedText: string; revision: number | null;
  materials: MaterialRecord[]; savedIds: string; checking: boolean; materialError: string;
  loading: boolean; saving: boolean; error: string;
}

export function useDraft(scope: DraftScope) {
  const entries = useRef(new Map<string, Entry>());
  const [, render] = useState(0);
  const refresh = () => render(value => value + 1);
  const key = JSON.stringify([scope.projectId, scope.taskId]);
  let entry = entries.current.get(key);
  if (!entry) {
    entry = { scope, text: '', savedText: '', revision: null, materials: [], savedIds: '[]', checking: false, materialError: '', loading: false, saving: false, error: '' };
    entries.current.set(key, entry);
  }
  const current = entry;
  const ids = (value: Entry) => JSON.stringify(value.materials.map(material => material.materialId));
  async function check(value: Entry) {
    if (value.checking || !value.materials.length) return;
    const requestedIds = ids(value);
    value.checking = true; value.materialError = ''; refresh();
    try {
      const checked = await window.agentx.checkMaterials(JSON.parse(requestedIds));
      if (ids(value) === requestedIds) value.materials = checked;
    } catch (cause) { if (ids(value) === requestedIds) value.materialError = cause instanceof Error ? cause.message : '材料核验失败，请重查'; }
    finally { value.checking = false; refresh(); }
  }
  async function load(value: Entry) {
    if (value.loading || value.revision !== null) return;
    value.loading = true; value.error = ''; refresh();
    try {
      const saved = await window.agentx.getDraft(value.scope);
      value.text = saved.text; value.savedText = saved.text; value.revision = saved.revision;
      value.materials = saved.materials; value.savedIds = ids(value);
      void check(value);
    } catch (cause) { value.error = cause instanceof Error ? cause.message : '草稿读取失败'; }
    finally { value.loading = false; refresh(); }
  }
  async function persist(value: Entry) {
    if (value.saving || value.revision === null) return;
    value.saving = true; value.error = ''; refresh();
    try {
      // 每个输入现场单独串行写入；写入期间的新编辑在下一次迭代保存。
      while (value.text !== value.savedText || ids(value) !== value.savedIds) {
        const text = value.text, selectedIds = ids(value);
        const saved = await window.agentx.saveDraft({ ...value.scope, text, materialIds: JSON.parse(selectedIds), expectedRevision: value.revision });
        value.revision = saved.revision; value.savedText = text; value.savedIds = selectedIds;
      }
    } catch (cause) { value.error = cause instanceof Error ? cause.message : '草稿保存失败，输入仍保留在窗口中'; }
    finally { value.saving = false; refresh(); }
  }
  useEffect(() => { void load(current); }, [key]);
  useEffect(() => {
    const focused = () => { void check(current); };
    window.addEventListener('focus', focused);
    if (current.revision !== null) void check(current);
    return () => window.removeEventListener('focus', focused);
  }, [key]);
  return {
    text: current.text, loading: current.revision === null, saving: current.saving, error: current.error,
    materials: current.materials, checking: current.checking, materialError: current.materialError, revision: current.revision,
    latestText: () => current.text,
    latestMaterials: () => current.materials,
    setMaterials(materials: MaterialRecord[]) {
      if (current.revision === null) return;
      current.materials = materials; current.materialError = ''; refresh();
      if (!current.error) void persist(current);
    },
    checkMaterials: () => check(current),
    setText(text: string) {
      if (current.revision === null) return;
      current.text = text; refresh();
      if (!current.error) void persist(current);
    },
    retry() { if (current.revision === null) void load(current); else void persist(current); },
    // 仅供首次提交确认后新建的任务：没有历史草稿，CAS=0 不会覆盖并发写入。
    seedNewTask(target: DraftScope, text: string, materials: MaterialRecord[] = []) {
      const targetKey = JSON.stringify([target.projectId, target.taskId]);
      if (entries.current.has(targetKey)) return;
      const value: Entry = { scope: target, text, savedText: '', materials, savedIds: '[]', checking: false, materialError: '', revision: 0, loading: false, saving: false, error: '' };
      entries.current.set(targetKey, value); void persist(value);
    },
  };
}
