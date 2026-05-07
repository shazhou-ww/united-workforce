export type WorkflowHistoryEntry = {
  hash: string;
  timestamp: number;
};

export type WorkflowRegistryEntry = {
  hash: string;
  timestamp: number;
  history: WorkflowHistoryEntry[];
};

/** LLM provider settings under `config.extract` in workflow.yaml (apiKey resolved after parse). */
export type ExtractProviderConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
};

export type WorkflowConfig = {
  maxDepth: number;
  extract: ExtractProviderConfig;
};

export type WorkflowRegistryFile = {
  config: WorkflowConfig | null;
  workflows: Record<string, WorkflowRegistryEntry>;
};
