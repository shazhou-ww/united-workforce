import type { ParsedAddArgv } from "../src/cmd-add.js";

export function addCliArgs(name: string, filePath: string): ParsedAddArgv {
  return { name, filePath, typesPath: null };
}
