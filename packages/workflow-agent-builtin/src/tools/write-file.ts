import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolvePath } from "./path.js";
import type { BuiltinTool } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const writeFileTool: BuiltinTool = {
  name: "write_file",
  description: "Write UTF-8 text to a file in the workspace (creates parent directories).",
  parameters: {
    type: "object",
    required: ["path", "content"],
    properties: {
      path: { type: "string", description: "Relative or absolute path within the workspace." },
      content: { type: "string", description: "File contents to write." },
    },
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    if (!isRecord(args) || typeof args.path !== "string" || typeof args.content !== "string") {
      return "Error: path and content must be strings";
    }
    const resolved = resolvePath(ctx.cwd, args.path);
    try {
      await mkdir(dirname(resolved), { recursive: true });
      await writeFile(resolved, args.content, "utf8");
      return `Wrote ${args.content.length} bytes to ${args.path}`;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return `Error: ${message}`;
    }
  },
};
