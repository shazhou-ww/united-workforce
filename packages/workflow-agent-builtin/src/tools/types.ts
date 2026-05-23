import type { JSONSchema } from "@uncaged/json-cas";

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
