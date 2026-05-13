import { readFile } from "node:fs/promises";
import type { ToolEntry } from "./types.js";

export const readFileTool: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a text file and return lines with line numbers.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file to read" },
          offset: {
            type: ["number", "null"],
            description: "Start line number (1-indexed, default: 1)",
          },
          limit: { type: ["number", "null"], description: "Max lines to read (default: all)" },
        },
        required: ["path"],
      },
    },
  },
  handler: async (args: string): Promise<string> => {
    try {
      const parsed = JSON.parse(args) as {
        path: string;
        offset: number | null;
        limit: number | null;
      };
      const content = await readFile(parsed.path, "utf-8");
      const allLines = content.split("\n");
      const offset = parsed.offset ?? 1;
      const start = Math.max(0, offset - 1);
      const end =
        parsed.limit != null ? Math.min(allLines.length, start + parsed.limit) : allLines.length;
      const lines = allLines.slice(start, end);
      return lines.map((line, i) => `${start + i + 1}|${line}`).join("\n");
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
