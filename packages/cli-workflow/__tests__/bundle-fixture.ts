import type { ParsedAddArgv } from "../src/commands/workflow/add-argv.js";

export function addCliArgs(name: string, filePath: string): ParsedAddArgv {
  return { name, filePath, typesPath: null };
}
