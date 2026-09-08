import { useEffect, useRef, useState } from 'react';
import type { TaskHistory } from '../../shared/contracts/history';

export function useHistory(taskId: string | null, completedTurnId: string | null) {
  const sequence = useRef(0);
  const [state, setState] = useState<{ taskId: string | null; loading: boolean; value: TaskHistory | null; error: string }>({ taskId: null, loading: false, value: null, error: '' });
  async function load() {
    const current = ++sequence.current;
    const canRead = !!taskId && !!completedTurnId;
    setState(previous => ({ taskId, loading: canRead, value: previous.taskId === taskId ? previous.value : null, error: '' }));
    if (!canRead) return;
    try {
      const value = await window.agentx.getTaskHistory({ taskId });
      if (value.taskId !== taskId) throw new Error('会话历史归属不匹配，请重新读取');
      if (value.turns.at(-1)?.turnId !== completedTurnId) throw new Error('历史的最后轮次已变化，请重新核对');
      if (current === sequence.current) setState({ taskId, loading: false, value, error: '' });
    } catch (cause) {
      if (current === sequence.current) setState(previous => ({ taskId, loading: false, value: previous.taskId === taskId ? previous.value : null, error: cause instanceof Error ? cause.message : '历史读取失败，请重试' }));
    }
  }
  useEffect(() => { void load(); return () => { sequence.current++; }; }, [taskId, completedTurnId]);
  return { ...(state.taskId === taskId ? state : { taskId, loading: !!taskId && !!completedTurnId, value: null, error: '' }), load };
}
