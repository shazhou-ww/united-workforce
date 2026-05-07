import { normalizeRefsField } from "./refs-field.js";
import { err, ok, type Result } from "./result.js";
import type { RoleOutput, WorkflowResult } from "./types.js";

/** Role steps replayed from `.data.jsonl`, including persisted timestamps. */
export type ForkHistoricalStep = RoleOutput & { timestamp: number };

export type ParsedThreadStartRecord = {
  workflowName: string;
  hash: string;
  threadId: string;
  prompt: string;
  maxRounds: number;
  depth: number;
};

/** Recognizes a persisted workflow completion line (no `role`; has numeric `returnCode` and string `summary`). */
export function tryParseWorkflowResultRecord(obj: Record<string, unknown>): WorkflowResult | null {
  if (obj.role !== undefined) {
    return null;
  }
  const returnCode = obj.returnCode;
  const summary = obj.summary;
  if (typeof returnCode !== "number" || typeof summary !== "string") {
    return null;
  }
  return { returnCode, summary };
}

export function tryParseRoleStepRecord(obj: Record<string, unknown>): ForkHistoricalStep | null {
  const role = obj.role;
  const contentHash = obj.contentHash;
  const meta = obj.meta;
  const timestamp = obj.timestamp;
  if (typeof role !== "string") {
    return null;
  }
  if (typeof contentHash !== "string") {
    return null;
  }
  if (meta === null || typeof meta !== "object") {
    return null;
  }
  if (typeof timestamp !== "number") {
    return null;
  }
  return {
    role,
    contentHash,
    meta: meta as Record<string, unknown>,
    refs: normalizeRefsField(obj.refs),
    timestamp,
  };
}

function parseRoleLine(
  obj: Record<string, unknown>,
  lineIndex: number,
): Result<ForkHistoricalStep, string> {
  const parsed = tryParseRoleStepRecord(obj);
  if (parsed === null) {
    return err(`invalid role record at line ${lineIndex}`);
  }
  return ok(parsed);
}

function parseStartRecordLine(firstLine: string): Result<ParsedThreadStartRecord, string> {
  let startParsed: unknown;
  try {
    startParsed = JSON.parse(firstLine) as unknown;
  } catch {
    return err("invalid JSON on line 1 (start record)");
  }
  if (startParsed === null || typeof startParsed !== "object") {
    return err("invalid start record shape");
  }
  const startRec = startParsed as Record<string, unknown>;
  const name = startRec.name;
  const hash = startRec.hash;
  const threadId = startRec.threadId;
  const parameters = startRec.parameters;
  if (typeof name !== "string" || typeof hash !== "string" || typeof threadId !== "string") {
    return err("start record missing name, hash, or threadId");
  }
  if (parameters === null || typeof parameters !== "object") {
    return err("start record missing parameters");
  }
  const paramsRec = parameters as Record<string, unknown>;
  const prompt = paramsRec.prompt;
  const options = paramsRec.options;
  if (typeof prompt !== "string") {
    return err("start record missing parameters.prompt");
  }
  if (options === null || typeof options !== "object") {
    return err("start record missing parameters.options");
  }
  const optRec = options as Record<string, unknown>;
  const maxRounds = optRec.maxRounds;
  if (typeof maxRounds !== "number") {
    return err("start record missing parameters.options.maxRounds");
  }

  const depthRaw = optRec.depth;
  const depth =
    typeof depthRaw === "number" && Number.isFinite(depthRaw) ? Math.trunc(depthRaw) : 0;

  return ok({
    workflowName: name,
    hash,
    threadId,
    prompt,
    maxRounds,
    depth,
  });
}

function parseFollowingRoleLines(lines: string[]): Result<ForkHistoricalStep[], string> {
  const roleSteps: ForkHistoricalStep[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) {
      break;
    }
    let rec: unknown;
    try {
      rec = JSON.parse(line) as unknown;
    } catch {
      return err(`invalid JSON at line ${i + 1}`);
    }
    if (rec === null || typeof rec !== "object") {
      return err(`invalid record at line ${i + 1}`);
    }
    const recObj = rec as Record<string, unknown>;
    const wf = tryParseWorkflowResultRecord(recObj);
    if (wf !== null) {
      if (i !== lines.length - 1) {
        return err("WorkflowResult record must be the final line in `.data.jsonl`");
      }
      break;
    }
    const parsed = parseRoleLine(recObj, i + 1);
    if (!parsed.ok) {
      return parsed;
    }
    roleSteps.push(parsed.value);
  }
  return ok(roleSteps);
}

/**
 * Parse RFC-001 `.data.jsonl`: line 1 start record, line 2+ role outputs.
 */
export function parseThreadDataJsonl(text: string): Result<
  {
    start: ParsedThreadStartRecord;
    roleSteps: ForkHistoricalStep[];
  },
  string
> {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lines.length === 0) {
    return err("thread data is empty");
  }

  const firstLine = lines[0];
  if (firstLine === undefined) {
    return err("thread data is empty");
  }

  const start = parseStartRecordLine(firstLine);
  if (!start.ok) {
    return start;
  }

  const roleSteps = parseFollowingRoleLines(lines);
  if (!roleSteps.ok) {
    return roleSteps;
  }

  return ok({
    start: start.value,
    roleSteps: roleSteps.value,
  });
}

function orderedUniqueRoles(roleSteps: ForkHistoricalStep[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of roleSteps) {
    if (!seen.has(s.role)) {
      seen.add(s.role);
      out.push(s.role);
    }
  }
  return out;
}

/**
 * Select historical steps for a fork:
 * - `fromRole === null`: drop the last step (retry the last role).
 * - `fromRole !== null`: keep steps through the first occurrence of that role (inclusive).
 */
export function selectForkHistoricalSteps(
  roleSteps: ForkHistoricalStep[],
  fromRole: string | null,
): Result<ForkHistoricalStep[], string> {
  if (roleSteps.length === 0) {
    return err("thread has no completed role steps to fork from");
  }

  if (fromRole === null) {
    if (roleSteps.length === 1) {
      return ok([]);
    }
    return ok(roleSteps.slice(0, -1));
  }

  const idx = roleSteps.findIndex((s) => s.role === fromRole);
  if (idx < 0) {
    const available = orderedUniqueRoles(roleSteps);
    return err(`role not found in thread: ${fromRole} (available: ${available.join(", ")})`);
  }
  return ok(roleSteps.slice(0, idx + 1));
}

export type ForkPlan = {
  workflowName: string;
  hash: string;
  sourceThreadId: string;
  prompt: string;
  runOptions: { maxRounds: number; depth: number };
  historicalSteps: ForkHistoricalStep[];
};

/**
 * Read `.data.jsonl` text and compute fork payload for the worker `run` command.
 */
export function buildForkPlan(
  dataJsonlText: string,
  fromRole: string | null,
): Result<ForkPlan, string> {
  const parsed = parseThreadDataJsonl(dataJsonlText);
  if (!parsed.ok) {
    return parsed;
  }
  const selected = selectForkHistoricalSteps(parsed.value.roleSteps, fromRole);
  if (!selected.ok) {
    return selected;
  }
  const { start } = parsed.value;
  return ok({
    workflowName: start.workflowName,
    hash: start.hash,
    sourceThreadId: start.threadId,
    prompt: start.prompt,
    runOptions: { maxRounds: start.maxRounds, depth: start.depth },
    historicalSteps: selected.value,
  });
}
