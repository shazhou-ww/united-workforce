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
  workflows: Record<string, WorkflowRegistryEntry>;
};
