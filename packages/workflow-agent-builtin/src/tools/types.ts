import type { JSONSchema } from "@ocas/core";

export type ToolContext = {
  cwd: string;
  storageRoot: string;
};

export type BuiltinTool = {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: (args: unknown, ctx: ToolContext) => Promise<string>;
};
