import type { DraftScope } from './drafts';
import type { MaterialStatus, MaterialVersion } from './materials';

export const FILE_PREVIEW_READ_CHANNEL = 'agentx:file-preview-read';
export const FILE_PREVIEW_OPEN_CHANNEL = 'agentx:file-preview-open';
export interface MaterialPreviewSource { kind: 'material'; scope: DraftScope; materialId: string }
export type FilePreviewSource = MaterialPreviewSource;
export interface FilePreview {
  source: FilePreviewSource;
  name: string;
  path: string;
  status: MaterialStatus;
  message: string;
  version: MaterialVersion | null;
  currentVersion: MaterialVersion | null;
  text: string | null;
  observedAt: string;
  taskId: string | null;
  turnId: string | null;
  operationId: string | null;
}
export interface FilePreviewOpen { source: FilePreviewSource; action: 'open' | 'reveal' }
