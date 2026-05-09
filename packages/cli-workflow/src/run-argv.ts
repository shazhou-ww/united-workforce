import { err, ok, type Result } from "@uncaged/workflow-protocol";

export type ParsedRunArgv = {
  name: string;
  prompt: string;
  maxRounds: number;
};

type FlagOk = { kind: "prompt"; value: string } | { kind: "max-rounds"; value: number };

function parseFlagAt(argv: string[], index: number): Result<FlagOk, string> | null {
  const flag = argv[index];
  if (flag === "--prompt") {
    const value = argv[index + 1];
    if (value === undefined) {
      return err("missing value for --prompt");
    }
    return ok({ kind: "prompt", value });
  }
  if (flag === "--max-rounds") {
    const value = argv[index + 1];
    if (value === undefined) {
      return err("missing value for --max-rounds");
    }
    const n = Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      return err("--max-rounds must be a non-negative integer");
    }
    return ok({ kind: "max-rounds", value: n });
  }
  return null;
}

export function parseRunArgv(argv: string[]): Result<ParsedRunArgv, string> {
  let name: string | undefined;
  let prompt = "";
  let maxRounds = 10;

  let i = 0;
  const first = argv[0];
  if (first !== undefined && !first.startsWith("--")) {
    name = first;
    i = 1;
  }

  while (i < argv.length) {
    const parsed = parseFlagAt(argv, i);
    if (parsed === null) {
      const unknown = argv[i];
      return err(`unknown run flag: ${unknown}`);
    }
    if (!parsed.ok) {
      return parsed;
    }

    const flag = parsed.value;
    if (flag.kind === "prompt") {
      prompt = flag.value;
      i += 2;
      continue;
    }
    maxRounds = flag.value;
    i += 2;
  }

  if (name === undefined || name === "") {
    return err("run requires <name>");
  }

  return ok({ name, prompt, maxRounds });
}
