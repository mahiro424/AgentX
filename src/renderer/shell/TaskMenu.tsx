import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { TaskMenuState } from './useWorkspace';

export function TaskMenu({ menu, onRename, onClose }: { menu: TaskMenuState; onRename: () => void; onClose: (restoreFocus?: boolean) => void }) {
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
        event.preventDefault(); element.current?.querySelector<HTMLButtonElement>('button')?.focus();
      }
    }}>
    <button role="menuitem" onClick={onRename}>重命名会话</button>
  </div>, document.body);
}
