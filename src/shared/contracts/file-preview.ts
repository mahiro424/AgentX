import type { DraftScope } from './drafts';
import type { MaterialStatus, MaterialVersion } from './materials';
import type { Spreadsheet } from './spreadsheet';

export const FILE_PREVIEW_READ_CHANNEL = 'agentx:file-preview-read';
export const FILE_PREVIEW_OPEN_CHANNEL = 'agentx:file-preview-open';
export interface MaterialPreviewSource { kind: 'material'; scope: DraftScope; materialId: string }
export interface ResultPreviewSource { kind: 'result'; taskId: string; resultId: string }
export type FilePreviewSource = MaterialPreviewSource | ResultPreviewSource;
export interface FilePreview {
  source: FilePreviewSource;
  name: string;
  path: string;
  status: MaterialStatus;
  message: string;
  version: Pick<MaterialVersion, 'size' | 'sha256'> | null;
  currentVersion: Pick<MaterialVersion, 'size' | 'sha256'> | null;
  text: string | null;
  spreadsheet?: Spreadsheet | null;
  observedAt: string;
  taskId: string | null;
  turnId: string | null;
  operationId: string | null;
}
export interface FilePreviewOpen { source: FilePreviewSource; action: 'open' | 'reveal' }
