import type { TaskHistory } from './history';

export const TASK_SEARCH_CHANNEL = 'agentx:task-search';
export const TASK_SEARCH_LOCATE_CHANNEL = 'agentx:task-search-locate';
export const SEARCH_INDEX_READ_CHANNEL = 'agentx:search-index-read';
export const SEARCH_INDEX_REBUILD_CHANNEL = 'agentx:search-index-rebuild';
export const SEARCH_INDEX_CHANGED_CHANNEL = 'agentx:search-index-changed';
export interface SearchIndexState { running: boolean; processed: number; total: number; error: string | null; notice?: string }

export interface TaskSearchRequest {
  query: string;
  scope: 'all' | 'title' | 'body';
  projectId: string | null;
  includeArchived: boolean;
}

export interface SearchSource { threadId: string; turnId: string; itemId: string; sourceRevision: string }
export interface TaskSearchTarget extends SearchSource { taskId: string }
export interface TaskSearchLocation { taskId: string; source: SearchSource; history: TaskHistory }
export interface SearchSnippet { text: string; ranges: [number, number][] }
export interface TaskSearchResult {
  taskId: string;
  title: string;
  projectId: string;
  projectName: string;
  lastActivityAt: string;
  archived: boolean;
  match: 'recent' | 'title' | 'body';
  snippet: SearchSnippet | null;
  source: SearchSource | null;
  sourceError: string | null;
}
export interface SearchCoverage {
  totalTasks: number;
  coveredTasks: number;
  issues: { taskId: string; title: string; reason: string }[];
}
export interface TaskSearchSnapshot { results: TaskSearchResult[]; coverage: SearchCoverage }
