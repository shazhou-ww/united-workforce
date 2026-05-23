import type { OpenAiToolDefinition } from "../llm/index.js";

import { readFileTool } from "./read-file.js";
import { runCommandTool } from "./run-command.js";
import type { BuiltinTool, ToolContext } from "./types.js";
import { writeFileTool } from "./write-file.js";

export { resolvePath } from "./path.js";
export type { BuiltinTool, ToolContext } from "./types.js";

const BUILTIN_TOOLS: BuiltinTool[] = [readFileTool, writeFileTool, runCommandTool];

export function getBuiltinTools(): readonly BuiltinTool[] {
  return BUILTIN_TOOLS;
}

export function builtinToolsToOpenAi(tools: readonly BuiltinTool[]): OpenAiToolDefinition[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as Record<string, unknown>,
    },
  }));
}

export async function executeBuiltinTool(
  name: string,
  argsJson: string,
  ctx: ToolContext,
): Promise<string> {
  const tool = BUILTIN_TOOLS.find((t) => t.name === name);
  if (tool === undefined) {
    return `Error: unknown tool ${name}`;
  }
  let args: unknown;
  try {
    args = JSON.parse(argsJson) as unknown;
  } catch {
    return "Error: tool arguments must be valid JSON";
  }
  return tool.execute(args, ctx);
}
