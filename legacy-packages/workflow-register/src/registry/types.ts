import type { WorkflowConfig } from "@uncaged/workflow-protocol";

export type { WorkflowConfig } from "@uncaged/workflow-protocol";

export type WorkflowHistoryEntry = {
  hash: string;
  timestamp: number;
};

export type WorkflowRegistryEntry = {
  hash: string;
  timestamp: number;
  history: WorkflowHistoryEntry[];
};

export type WorkflowRegistryFile = {
  config: WorkflowConfig | null;
  workflows: Record<string, WorkflowRegistryEntry>;
};
