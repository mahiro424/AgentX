export const MATERIAL_CHOOSE_CHANNEL = 'agentx:material-choose';
export const MATERIAL_DROP_CHANNEL = 'agentx:material-drop';
export const MATERIAL_CHECK_CHANNEL = 'agentx:material-check';
export const MATERIAL_REFRESH_CHANNEL = 'agentx:material-refresh';
export const MATERIAL_PASTE_CHANNEL = 'agentx:material-paste-image';

export const MATERIAL_LIMITS = { count: 16, textBytes: 1024 * 1024, imageBytes: 8 * 1024 * 1024, spreadsheetBytes: 8 * 1024 * 1024 } as const;
export type MaterialKind = 'text' | 'directory' | 'image' | 'spreadsheet' | 'unsupported';
export type MaterialStatus = 'ready' | 'changed' | 'missing' | 'unreadable' | 'unsupported' | 'blockedImage';
export interface MaterialVersion {
  identity: string;
  size: number;
  sha256: string | null;
}
export interface MaterialRecord {
  materialId: string;
  path: string;
  name: string;
  kind: MaterialKind;
  status: MaterialStatus;
  message: string;
  version: MaterialVersion | null;
}
export type MaterialChoice = 'files' | 'directory' | 'images';
export interface DraftMaterialInput { revision: number; ids: string[] }
export interface FrozenMaterialInput { revision: number; records: MaterialRecord[] }
