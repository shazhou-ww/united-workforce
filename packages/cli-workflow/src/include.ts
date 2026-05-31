import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * Create a YAML customTags entry for !include that resolves file paths
 * relative to the given base directory.
 */
export function createIncludeTag(baseDir: string) {
  return {
    tag: "!include",
    resolve(str: string) {
      const filePath = resolve(baseDir, str);
      const content = readFileSync(filePath, "utf8");
      const ext = extname(filePath).toLowerCase();
      if (ext === ".json") {
        return JSON.parse(content);
      }
      if (ext === ".yaml" || ext === ".yml") {
        return parseYaml(content);
      }
      return content;
    },
  };
}
