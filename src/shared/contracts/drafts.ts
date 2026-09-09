import type { MaterialRecord } from './materials';

export const DRAFT_READ_CHANNEL = 'agentx:draft-read';
export const DRAFT_SAVE_CHANNEL = 'agentx:draft-save';

export interface DraftScope { projectId: string | null; taskId: string | null }
export interface DraftRecord extends DraftScope { text: string; revision: number; materials: MaterialRecord[] }
// 省略 materialIds 仅修改文本；显式空数组才移除材料。
export interface DraftSave extends DraftScope { text: string; expectedRevision: number; materialIds?: string[] }
