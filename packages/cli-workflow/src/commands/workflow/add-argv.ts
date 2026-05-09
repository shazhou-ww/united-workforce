import { err, ok, type Result } from "@uncaged/workflow-protocol";

import type { ParsedAddArgv } from "./types.js";

type ParsedLongFlag = { advance: 2; kind: "types"; value: string };

function tryParseAddLongFlag(argv: string[], index: number): Result<ParsedLongFlag | null, string> {
  const tok = argv[index];
  if (tok !== "--types") {
    return ok(null);
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    return err("missing value for --types");
  }
  return ok({ advance: 2, kind: "types", value });
}

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

export function parseAddArgv(argv: string[]): Result<ParsedAddArgv, string> {
  const slots: PositionalSlots = { name: undefined, filePath: undefined };
  let typesPath: string | null = null;

  let i = 0;
  while (i < argv.length) {
    const flag = tryParseAddLongFlag(argv, i);
    if (!flag.ok) {
      return flag;
    }
    if (flag.value !== null) {
      typesPath = flag.value.value;
      i += flag.value.advance;
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

  return ok({ name, filePath, typesPath });
}
