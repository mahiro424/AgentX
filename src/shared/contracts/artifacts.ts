export interface ArtifactReference {
  resultId: string;
  taskId: string;
  threadId: string;
  turnId: string;
  operationId: string;
  path: string;
  size: number;
  sha256: string;
  observedAt: string;
}
