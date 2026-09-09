import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MATERIAL_LIMITS, type MaterialChoice, type MaterialRecord } from '../../shared/contracts/materials';

export function useMaterialActions(getMaterials: () => MaterialRecord[], setMaterials: (items: MaterialRecord[]) => void) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const serial = useRef(0), locked = useRef(false);
  useEffect(() => () => { serial.current++; }, []);
  async function apply(action: () => Promise<MaterialRecord[]>, replacing?: string) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    const operation = ++serial.current;
    try {
      const incoming = await action();
      if (serial.current !== operation || !incoming.length) return;
      const current = getMaterials();
      const merged = current.filter(item => item.materialId !== replacing);
      for (const item of incoming) {
        if (!merged.some(previous => previous.path === item.path || (item.version && previous.version?.identity === item.version.identity))) merged.push(item);
      }
      if (merged.length > MATERIAL_LIMITS.count) throw new Error('每个草稿最多保留 16 项材料；请先移除部分材料');
      setMaterials(merged);
    } catch (cause) { if (serial.current === operation) setError(cause instanceof Error ? cause.message : '材料添加失败，原草稿保留'); }
    finally { if (serial.current === operation) { locked.current = false; setBusy(false); } }
  }
  return { busy, error,
    choose: (kind: MaterialChoice) => apply(() => window.agentx.chooseMaterials(kind)),
    drop: (files: File[]) => apply(() => window.agentx.addDroppedMaterials(files)),
    paste: () => apply(() => window.agentx.pasteMaterialImage()),
    refresh: (id: string) => apply(async () => [await window.agentx.refreshMaterial(id)], id),
    cancel() { serial.current++; locked.current = false; setBusy(false); setError('已取消本次添加，原材料保留'); },
  };
}

export function MaterialsList({ materials, checking, saving, actions, remove, open }: { materials: MaterialRecord[]; checking: boolean; saving: boolean;
  actions: ReturnType<typeof useMaterialActions>; remove: (id: string) => void; open: (item: MaterialRecord, trigger: HTMLButtonElement) => void }) {
  return <>
    {materials.length > 0 && <ul className="material-list" aria-label="本轮材料">{materials.map(item => <li key={item.materialId} className="material-chip" data-failed={item.status !== 'ready'}>
      <span className="material-kind" aria-hidden="true">{item.kind === 'directory' ? '目录' : item.kind === 'image' ? '图片' : item.kind === 'spreadsheet' ? (/\.csv$/i.test(item.name) ? 'CSV' : 'XLSX') : item.kind === 'document' ? 'DOCX' : item.kind === 'text' ? (/\.txt$/i.test(item.name) ? 'TXT' : 'MD') : '文件'}</span>
      <span className="material-description" title={item.path}><button className="material-name" disabled={saving} aria-label={`预览材料：${item.name}`}
        onClick={event => open(item, event.currentTarget)}>{item.name}</button><span>{checking ? '正在核验…' : item.message}</span></span>
      {item.status !== 'ready' && <button className="text-button" disabled={actions.busy || checking} aria-label={`重查材料：${item.name}`} onClick={() => void actions.refresh(item.materialId)}>重查</button>}
      <button className="icon-button" disabled={actions.busy} aria-label={`移除材料：${item.name}`} title="从草稿移除，不删除原件" onClick={() => remove(item.materialId)}>×</button>
    </li>)}</ul>}
    {actions.busy && <p className="muted" role="status">正在选择或核验材料… <button className="text-button" onClick={actions.cancel}>取消添加</button></p>}
    {actions.error && <p className="error-message" role="alert">{actions.error}</p>}
  </>;
}

export function MaterialsMenu({ disabled, choose }: { disabled: boolean; choose: (kind: MaterialChoice) => Promise<void> }) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const close = () => { setPosition(null); trigger.current?.focus(); };
  useEffect(() => {
    if (!position) return;
    menu.current?.querySelector('button')?.focus();
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setPosition(null); };
    const resize = () => setPosition(null);
    document.addEventListener('pointerdown', outside); window.addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', resize); };
  }, [position]);
  return <>
    <button ref={trigger} className="icon-button" aria-label="添加材料" title="添加材料" aria-haspopup="menu" aria-expanded={!!position} disabled={disabled}
      onClick={() => { if (position) close(); else { const bounds = trigger.current!.getBoundingClientRect(); setPosition({ x: Math.min(bounds.left, innerWidth - 196), y: Math.max(8, bounds.top - 146) }); } }}>
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 4v16M4 12h16" /></svg></button>
    {position && createPortal(<div ref={menu} className="project-menu" role="menu" aria-label="添加材料" style={{ left: position.x, top: position.y }} onKeyDown={event => {
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); close(); }
      if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const buttons = Array.from(menu.current!.querySelectorAll('button'));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }
    }}>{([['files', '添加文件'], ['directory', '添加目录引用'], ['images', '添加图片']] as const).map(([kind, label]) =>
      <button role="menuitem" key={kind} onClick={() => { close(); void choose(kind); }}>{label}</button>)}</div>, document.body)}
  </>;
}
