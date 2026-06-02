import { readFile, stat } from "node:fs/promises";
import { resolvePath } from "./path.js";
import type { BuiltinTool } from "./types.js";

const MAX_READ_BYTES = 512 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const readFileTool: BuiltinTool = {
  name: "read_file",
  description: "Read a UTF-8 text file from the workspace.",
  parameters: {
    type: "object",
    required: ["path"],
    properties: {
      path: { type: "string", description: "Relative or absolute path within the workspace." },
    },
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    if (!isRecord(args) || typeof args.path !== "string") {
      return "Error: path must be a string";
    }
    const resolved = resolvePath(ctx.cwd, args.path);
    try {
      const info = await stat(resolved);
      if (!info.isFile()) {
        return "Error: not a file";
      }
      if (info.size > MAX_READ_BYTES) {
        return `Error: file exceeds ${MAX_READ_BYTES} byte limit`;
      }
      return await readFile(resolved, "utf8");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return `Error: ${message}`;
    }
  },
};
