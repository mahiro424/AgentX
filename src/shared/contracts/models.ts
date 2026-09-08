export const MODEL_SETTINGS_READ_CHANNEL = 'agentx:model-settings-read';
export const MODEL_KEY_SAVE_CHANNEL = 'agentx:model-key-save';
export const MODEL_KEY_REVEAL_CHANNEL = 'agentx:model-key-reveal';
export const MODEL_SETTINGS_VISIBLE_CHANNEL = 'agentx:model-settings-visible';
export const MODEL_ENABLED_CHANNEL = 'agentx:model-enabled';
export const MODEL_CATALOG_FETCH_CHANNEL = 'agentx:model-catalog-fetch';
export const MODEL_SELECTION_CHANNEL = 'agentx:model-selection';
export const MODEL_ACTIVE_CHANNEL = 'agentx:model-active';
export const FLASH_MODEL_ID = 'deepseek-v4-flash';

export interface ModelSelectionChange extends ModelOperation { selectedModelIds: string[] }
export interface ActiveModelChange extends ModelOperation { activeModelId: string | null }

export interface ModelOperation {
  operationId: string;
  expectedRevision: number;
}

export interface ModelCatalog {
  modelIds: string[];
  fetchedAt: string | null;
  configRevision: number | null;
}

export interface ConnectionChange {
  operationId: string;
  expectedRevision: number;
  enabled: boolean;
}

export interface KeySubmission {
  operationId: string;
  expectedRevision: number;
  apiKey: string;
}

export interface ModelSettings {
  hasCredential: boolean;
  selectedModelIds: string[];
  configRevision: number;
  enabled: boolean;
  catalog: ModelCatalog;
  fetching: boolean;
  saving: boolean;
  fetchError: string | null;
  activeModelId: string | null;
  keySaveError: string | null;
  testing: ModelTestRequest | null;
  tests: ModelTestResult[];
}

export const MODEL_SETTINGS_CHANGED_CHANNEL = 'agentx:model-settings-changed';
export const MODEL_TEST_CHANNEL = 'agentx:model-test';
export interface ModelTestRequest extends ModelOperation { modelId: string }
export interface ModelTestResult {
  modelId: string;
  operationId: string;
  configRevision: number;
  testedAt: string;
  durationMs: number;
  outcome: 'passed' | 'failed';
  error: string | null;
  expired: boolean;
}
