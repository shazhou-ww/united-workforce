import { err, ok, type Result } from "@uncaged/workflow";

export type ParsedAddArgv = {
  name: string;
  filePath: string;
  /** Override path to descriptor YAML when adding an `.esm.js` bundle. */
  descriptorPath: string | null;
  /** Override path to `.d.ts` when adding an `.esm.js` bundle. */
  typesPath: string | null;
};

type ParsedLongFlag =
  | { advance: 2; kind: "descriptor"; value: string }
  | { advance: 2; kind: "types"; value: string };

type PositionalSlots = {
  name: string | undefined;
  filePath: string | undefined;
};

function assignPositional(tok: string, slots: PositionalSlots): Result<void, string> {
  if (slots.name === undefined) {
    slots.name = tok;
    return ok(undefined);
  }
  if (slots.filePath === undefined) {
    slots.filePath = tok;
    return ok(undefined);
  }
  return err("too many arguments");
}

function tryParseAddLongFlag(argv: string[], index: number): Result<ParsedLongFlag | null, string> {
  const tok = argv[index];
  if (tok !== "--descriptor" && tok !== "--types") {
    return ok(null);
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    return err(
      tok === "--descriptor" ? "missing value for --descriptor" : "missing value for --types",
    );
  }
  if (tok === "--descriptor") {
    return ok({ advance: 2, kind: "descriptor", value });
  }
  return ok({ advance: 2, kind: "types", value });
}

export function parseAddArgv(argv: string[]): Result<ParsedAddArgv, string> {
  const slots: PositionalSlots = { name: undefined, filePath: undefined };
  let descriptorPath: string | null = null;
  let typesPath: string | null = null;

  let i = 0;
  while (i < argv.length) {
    const flag = tryParseAddLongFlag(argv, i);
    if (!flag.ok) {
      return flag;
    }
    if (flag.value !== null) {
      const f = flag.value;
      if (f.kind === "descriptor") {
        descriptorPath = f.value;
      } else {
        typesPath = f.value;
      }
      i += f.advance;
      continue;
    }

    const tok = argv[i];
    if (tok?.startsWith("--")) {
      return err(`unknown add flag: ${tok}`);
    }
    if (tok === undefined) {
      break;
    }
    const placed = assignPositional(tok, slots);
    if (!placed.ok) {
      return placed;
    }
    i += 1;
  }

  const { name, filePath } = slots;
  if (name === undefined || name === "" || filePath === undefined || filePath === "") {
    return err("add requires <name> <file>");
  }

  return ok({ name, filePath, descriptorPath, typesPath });
}
