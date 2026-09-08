export const EXIT_READ_CHANNEL = 'agentx:exit-read';
export const EXIT_ANSWER_CHANNEL = 'agentx:exit-answer';
export const EXIT_CHANGED_CHANNEL = 'agentx:exit-changed';

export type ExitSnapshot = { state: 'idle' } | { state: 'confirm' | 'stopping' | 'error'; requestId: string; error: string | null };
export interface ExitAnswer { requestId: string; decision: 'cancel' | 'tray' | 'stop'; }
