export const DRAFT_READ_CHANNEL = 'agentx:draft-read';
export const DRAFT_SAVE_CHANNEL = 'agentx:draft-save';

export interface DraftScope { projectId: string | null; taskId: string | null }
export interface DraftRecord extends DraftScope { text: string; revision: number }
export interface DraftSave extends DraftScope { text: string; expectedRevision: number }
