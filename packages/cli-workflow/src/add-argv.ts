import { err, ok, type Result } from "@uncaged/workflow";

export type ParsedAddArgv = {
  name: string;
  filePath: string;
  /** Override path to descriptor YAML when adding an `.esm.js` bundle. */
  descriptorPath: string | null;
  /** Override path to `.d.ts` when adding an `.esm.js` bundle. */
  typesPath: string | null;
};

export function parseAddArgv(argv: string[]): Result<ParsedAddArgv, string> {
  let name: string | undefined;
  let filePath: string | undefined;
  let descriptorPath: string | null = null;
  let typesPath: string | null = null;

  let i = 0;
  while (i < argv.length) {
    const tok = argv[i];
    if (tok === "--descriptor") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        return err("missing value for --descriptor");
      }
      descriptorPath = value;
      i += 2;
      continue;
    }
    if (tok === "--types") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        return err("missing value for --types");
      }
      typesPath = value;
      i += 2;
      continue;
    }
    if (tok !== undefined && tok.startsWith("--")) {
      return err(`unknown add flag: ${tok}`);
    }
    if (tok === undefined) {
      break;
    }
    if (name === undefined) {
      name = tok;
    } else if (filePath === undefined) {
      filePath = tok;
    } else {
      return err("too many arguments");
    }
    i += 1;
  }

  if (name === undefined || name === "" || filePath === undefined || filePath === "") {
    return err("add requires <name> <file>");
  }

  return ok({ name, filePath, descriptorPath, typesPath });
}
