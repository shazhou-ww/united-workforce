import { readFile, writeFile } from "node:fs/promises";
import type { ToolEntry } from "./types.js";

export const patchFileTool: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "patch_file",
      description: "Find and replace a string in a file (first occurrence only).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file" },
          old_string: { type: "string", description: "Text to find" },
          new_string: { type: "string", description: "Replacement text" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  handler: async (args: string): Promise<string> => {
    try {
      const parsed = JSON.parse(args) as { path: string; old_string: string; new_string: string };
      const content = await readFile(parsed.path, "utf-8");
      const firstIdx = content.indexOf(parsed.old_string);
      if (firstIdx === -1) {
        return `Error: old_string not found in ${parsed.path}`;
      }
      const secondIdx = content.indexOf(parsed.old_string, firstIdx + 1);
      if (secondIdx !== -1) {
        return `Error: old_string is not unique in ${parsed.path} (found multiple occurrences)`;
      }
      const updated = content.slice(0, firstIdx) + parsed.new_string + content.slice(firstIdx + parsed.old_string.length);
      await writeFile(parsed.path, updated);
      return `Successfully patched ${parsed.path}`;
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
