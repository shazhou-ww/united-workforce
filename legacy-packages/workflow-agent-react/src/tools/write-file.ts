import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ToolEntry } from "./types.js";

export const writeFileTool: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to a file, creating parent directories as needed.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to write" },
          content: { type: "string", description: "File content" },
        },
        required: ["path", "content"],
      },
    },
  },
  handler: async (args: string): Promise<string> => {
    try {
      const parsed = JSON.parse(args) as { path: string; content: string };
      await mkdir(dirname(parsed.path), { recursive: true });
      const buf = Buffer.from(parsed.content, "utf-8");
      await writeFile(parsed.path, buf);
      return `Successfully wrote ${buf.length} bytes to ${parsed.path}`;
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
