import { err, ok, type Result } from "@uncaged/workflow-protocol";

export type ParsedRunArgv = {
  name: string;
  prompt: string;
};

function parseFlagAt(
  argv: string[],
  index: number,
): Result<{ kind: "prompt"; value: string }, string> | null {
  const flag = argv[index];
  if (flag === "--prompt") {
    const value = argv[index + 1];
    if (value === undefined) {
      return err("missing value for --prompt");
    }
    return ok({ kind: "prompt", value });
  }
  return null;
}

export function parseRunArgv(argv: string[]): Result<ParsedRunArgv, string> {
  let name: string | undefined;
  let prompt = "";

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
    prompt = flag.value;
    i += 2;
  }

  if (name === undefined || name === "") {
    return err("run requires <name>");
  }

  return ok({ name, prompt });
}
