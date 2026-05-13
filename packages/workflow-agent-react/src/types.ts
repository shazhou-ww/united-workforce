import type { LlmFn, ToolDefinition } from "@uncaged/workflow-reactor";

export type ReactToolHandler = (name: string, args: string) => Promise<string>;

export type ReactAdapterConfig = {
  llm: LlmFn;
  tools: readonly ToolDefinition[];
  toolHandler: ReactToolHandler;
  maxRounds: number;
};
