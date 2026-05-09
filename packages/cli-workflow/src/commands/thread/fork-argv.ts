import { err, ok, type Result } from "@uncaged/workflow-protocol";

import type { ParsedForkArgv } from "./types.js";

export function parseForkArgv(argv: string[]): Result<ParsedForkArgv, string> {
  if (argv.length === 0) {
    return err("fork requires <thread-id>");
  }
  const threadId = argv[0];
  if (threadId === undefined || threadId === "") {
    return err("fork requires <thread-id>");
  }
  let fromRole: string | null = null;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from-role") {
      const r = argv[i + 1];
      if (r === undefined || r === "") {
        return err("--from-role requires a role name");
      }
      fromRole = r;
      i++;
      continue;
    }
    return err(`unexpected argument: ${a}`);
  }
  return ok({ threadId, fromRole });
}
