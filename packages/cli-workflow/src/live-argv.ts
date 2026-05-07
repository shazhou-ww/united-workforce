import { err, ok, type Result } from "@uncaged/workflow";

export type ParsedLiveArgv = {
  threadId: string | null;
  latest: boolean;
  debug: boolean;
  role: string | null;
};

type LiveArgvScan = {
  latest: boolean;
  debug: boolean;
  role: string | null;
  threadId: string | null;
};

function applyLiveArgvToken(argv: string[], i: number, s: LiveArgvScan): Result<number, string> {
  const a = argv[i];
  if (a === "--latest") {
    s.latest = true;
    return ok(i + 1);
  }
  if (a === "--debug") {
    s.debug = true;
    return ok(i + 1);
  }
  if (a === "--role") {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) {
      return err("missing value for --role");
    }
    s.role = v;
    return ok(i + 2);
  }
  if (a.startsWith("--")) {
    return err(`unknown live flag: ${a}`);
  }
  if (s.threadId !== null) {
    return err("unexpected extra argument");
  }
  s.threadId = a;
  return ok(i + 1);
}

export function parseLiveArgv(argv: string[]): Result<ParsedLiveArgv, string> {
  const s: LiveArgvScan = {
    latest: false,
    debug: false,
    role: null,
    threadId: null,
  };

  let i = 0;
  while (i < argv.length) {
    const step = applyLiveArgvToken(argv, i, s);
    if (!step.ok) {
      return step;
    }
    i = step.value;
  }

  if (s.latest && s.threadId !== null) {
    return err("live --latest does not take <thread-id>");
  }
  if (!s.latest && s.threadId === null) {
    return err("live requires <thread-id> or --latest");
  }

  return ok({
    threadId: s.threadId,
    latest: s.latest,
    debug: s.debug,
    role: s.role,
  });
}
