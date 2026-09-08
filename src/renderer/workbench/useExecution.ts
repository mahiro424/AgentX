import { useEffect, useRef, useState } from 'react';
import type { ExecutionSnapshot } from '../../shared/contracts/execution';

export function useExecution() {
  const [snapshot, setSnapshot] = useState<ExecutionSnapshot | null>(null);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  async function load() {
    const current = ++sequence.current;
    try {
      const value = await window.agentx.getExecution();
      if (current === sequence.current) { setSnapshot(value); setError(''); return true; }
    } catch (cause) {
      if (current === sequence.current) setError(cause instanceof Error ? cause.message : '执行状态读取失败，请核对后重试');
    }
    return false;
  }
  useEffect(() => {
    const unsubscribe = window.agentx.onExecutionChanged(() => void load());
    void load();
    return () => { sequence.current++; unsubscribe(); };
  }, []);
  return { snapshot, error, load };
}
