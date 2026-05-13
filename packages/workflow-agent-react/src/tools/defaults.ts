import type { ToolDefinition } from "@uncaged/workflow-reactor";
import type { ToolEntry } from "./types.js";
import { readFileTool } from "./read-file.js";
import { writeFileTool } from "./write-file.js";
import { patchFileTool } from "./patch-file.js";
import { shellExecTool } from "./shell-exec.js";

const ALL_TOOLS: ToolEntry[] = [readFileTool, writeFileTool, patchFileTool, shellExecTool];

export const defaultTools: readonly ToolDefinition[] = ALL_TOOLS.map((t) => t.definition);

export async function defaultToolHandler(name: string, args: string): Promise<string> {
  const entry = ALL_TOOLS.find((t) => t.definition.function.name === name);
  if (!entry) return `Unknown tool: ${name}`;
  return entry.handler(args);
}
