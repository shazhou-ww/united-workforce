import type { ProviderConfig } from "../config/index.js";

export type WorkflowHistoryEntry = {
  hash: string;
  timestamp: number;
};

export type WorkflowRegistryEntry = {
  hash: string;
  timestamp: number;
  history: WorkflowHistoryEntry[];
};

export type WorkflowConfig = {
  maxDepth: number;
  providers: Record<string, ProviderConfig>;
  models: Record<string, string>;
};

export type WorkflowRegistryFile = {
  config: WorkflowConfig | null;
  workflows: Record<string, WorkflowRegistryEntry>;
};
