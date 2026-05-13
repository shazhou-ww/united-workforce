import type { ToolDefinition } from "@uncaged/workflow-reactor";

export type ToolHandler = (args: string) => Promise<string>;

export type ToolEntry = {
  definition: ToolDefinition;
  handler: ToolHandler;
};
