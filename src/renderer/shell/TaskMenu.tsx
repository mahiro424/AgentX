import { useEffect, useRef } from 'react';
import { TaskPinIcon } from './TaskPinIcon';
import { createPortal } from 'react-dom';
import type { TaskMenuState } from './useWorkspace';

export function TaskMenu({ menu, onRename, onPin, busy, onClose }: { menu: TaskMenuState; onRename: () => void; onPin: () => void; busy: boolean; onClose: (restoreFocus?: boolean) => void }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    element.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: PointerEvent) => { if (!element.current?.contains(event.target as Node)) onClose(false); };
    const resize = () => onClose();
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', resize); };
  }, [menu]);
  return createPortal(<div ref={element} className="project-menu" role="menu" aria-label="会话操作" style={{ left: menu.x, top: menu.y }}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onClose(); }
      if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const items = Array.from(element.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
          (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    }}>
    <button role="menuitem" onClick={onRename}>重命名会话</button>
    <button role="menuitem" disabled={busy} onClick={onPin}><TaskPinIcon />{menu.task.pinnedAt === null ? '置顶会话' : '取消置顶会话'}</button>
  </div>, document.body);
}
