import { readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * Create a YAML customTags entry for !include that resolves file paths
 * relative to the given base directory.
 *
 * Security: resolved paths must stay within baseDir (path traversal prevention).
 * Nested !include in .yaml/.yml files is supported (customTags passed recursively).
 */
export function createIncludeTag(baseDir: string) {
  const resolvedBase = resolve(baseDir);
  return {
    tag: "!include",
    resolve(str: string) {
      const filePath = resolve(resolvedBase, str);
      // Path traversal guard: resolved path must be inside baseDir
      if (!filePath.startsWith(`${resolvedBase}/`) && filePath !== resolvedBase) {
        throw new Error(
          `!include path traversal blocked: "${str}" resolves outside base directory`,
        );
      }
      const content = readFileSync(filePath, "utf8");
      const ext = extname(filePath).toLowerCase();
      if (ext === ".json") {
        return JSON.parse(content);
      }
      if (ext === ".yaml" || ext === ".yml") {
        // Pass customTags recursively so nested !include works,
        // scoped to the included file's directory
        return parseYaml(content, { customTags: [createIncludeTag(dirname(filePath))] });
      }
      return content;
    },
  };
}
