import type { CasStore } from "@ocas/core";
import type {
  CasRef,
  StartEntry,
  StepEntry,
  StepNodePayload,
  ThreadForkOutput,
  ThreadId,
  ThreadStepsOutput,
} from "@united-workforce/protocol";
import { createLogger, generateUlid } from "@united-workforce/util";
import { isThreadRunning } from "../background/index.js";
import { createUwfStore, getThread, readActiveTurns, setThread, type UwfStore } from "../store.js";
import {
  collectOrderedSteps,
  expandDeep,
  expandOutput,
  fail,
  resolveHeadHash,
  walkChain,
} from "./shared.js";

const log = createLogger({ sink: { kind: "stderr" } });

type TurnToolCall = {
  name: string;
  args: string;
};

type TurnData = {
  index: number;
  role: string;
  content: string;
  toolCalls: TurnToolCall[] | null;
};

/**
 * Build a StepEntry for a single step CAS hash, recursively populating its
 * `previousAttempts` from prior failed StepNode hashes (if any). Failed steps
 * are persisted to CAS but never reachable through `prev`; they live only via
 * the successful step's `previousAttempts` array.
 */
export function buildStepEntry(uwf: UwfStore, stepHash: CasRef): StepEntry | null {
  const node = uwf.store.cas.get(stepHash);
  if (node === null || node.type !== uwf.schemas.stepNode) {
    return null;
  }
  const payload = node.payload as StepNodePayload;
  const previousHashes = payload.previousAttempts ?? null;
  let previousAttempts: StepEntry[] | null = null;
  if (previousHashes !== null && previousHashes.length > 0) {
    const entries: StepEntry[] = [];
    for (const prevHash of previousHashes) {
      const entry = buildStepEntry(uwf, prevHash);
      if (entry !== null) {
        entries.push(entry);
      } else {
        log(
          "STP7K2QM",
          `previousAttempts ref ${prevHash} for step ${stepHash} did not resolve to a StepNode; skipping it in retry lineage`,
        );
      }
    }
    previousAttempts = entries.length > 0 ? entries : null;
  }
  return {
    hash: stepHash,
    role: payload.role,
    output: expandOutput(uwf, payload.output),
    detail: payload.detail ?? null,
    agent: payload.agent,
    timestamp: node.timestamp,
    durationMs: payload.completedAtMs - payload.startedAtMs,
    usage: payload.usage ?? null,
    previousAttempts,
  };
}

/**
 * Sum of usage across an entry and its nested previousAttempts.
 * Treats null usage as zero. Returns a flat aggregate — recursive traversal is
 * internal.
 */
export function sumStepEntryUsage(entry: StepEntry): {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  duration: number;
} {
  let turns = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let duration = 0;
  if (entry.usage !== null) {
    turns += entry.usage.turns;
    inputTokens += entry.usage.inputTokens;
    outputTokens += entry.usage.outputTokens;
    duration += entry.usage.duration;
  }
  if (entry.previousAttempts !== null) {
    for (const attempt of entry.previousAttempts) {
      const sub = sumStepEntryUsage(attempt);
      turns += sub.turns;
      inputTokens += sub.inputTokens;
      outputTokens += sub.outputTokens;
      duration += sub.duration;
    }
  }
  return { turns, inputTokens, outputTokens, duration };
}

/**
 * Aggregate token usage across the entire thread chain, including any
 * recorded failed retry attempts via `previousAttempts`. Returns zeros when
 * no usage is recorded anywhere on the thread.
 */
export async function aggregateThreadUsage(
  storageRoot: string,
  threadId: ThreadId,
): Promise<{
  turns: number;
  inputTokens: number;
  outputTokens: number;
  duration: number;
}> {
  const result = await cmdStepList(storageRoot, threadId);
  let turns = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let duration = 0;
  for (const entry of result.steps) {
    if (!isStepEntry(entry)) {
      continue;
    }
    const sub = sumStepEntryUsage(entry);
    turns += sub.turns;
    inputTokens += sub.inputTokens;
    outputTokens += sub.outputTokens;
    duration += sub.duration;
  }
  return { turns, inputTokens, outputTokens, duration };
}

function isStepEntry(entry: StartEntry | StepEntry): entry is StepEntry {
  return "role" in entry && "agent" in entry;
}

/**
 * List all steps in a thread (previously: thread steps)
 */
export async function cmdStepList(
  storageRoot: string,
  threadId: ThreadId,
): Promise<ThreadStepsOutput> {
  const headHash = await resolveHeadHash(storageRoot, threadId);
  const uwf = await createUwfStore(storageRoot);
  const chain = walkChain(uwf, headHash);

  const startNode = uwf.store.cas.get(chain.startHash);
  if (startNode === null) {
    fail(`StartNode not found: ${chain.startHash}`);
  }

  const startEntry: StartEntry = {
    hash: chain.startHash,
    workflow: chain.start.workflow,
    prompt: chain.start.prompt,
    timestamp: startNode.timestamp,
  };

  const stepEntries: StepEntry[] = [];
  const ordered = collectOrderedSteps(uwf, headHash, chain);

  for (const item of ordered) {
    const entry = buildStepEntry(uwf, item.hash);
    if (entry !== null) {
      stepEntries.push(entry);
    }
  }

  return {
    thread: threadId,
    workflow: chain.start.workflow,
    steps: [startEntry, ...stepEntries],
  };
}

/**
 * Show details of a specific step (previously: thread step-details).
 *
 * Returns a merged object that combines StepNode metadata (role / agent /
 * timing / usage) with the expanded broker-detail payload so callers can
 * read both layers in one envelope. The detail node by itself only carries
 * `{ sessionId, duration, turnCount, turns }` — without merging in the
 * StepNode metadata, `step show` would render empty `Role` / `Agent` /
 * `Status` / `-` `Duration` (issue #392).
 */
export async function cmdStepShow(storageRoot: string, stepHash: CasRef): Promise<unknown> {
  const uwf = await createUwfStore(storageRoot);
  const node = uwf.store.cas.get(stepHash);
  if (node === null) {
    fail(`CAS node not found: ${stepHash}`);
  }
  if (node.type !== uwf.schemas.stepNode) {
    fail(`node ${stepHash} is not a StepNode`);
  }
  const payload = node.payload as StepNodePayload;
  if (!payload.detail) {
    fail(`step ${stepHash} has no detail`);
  }
  const detail = expandDeep(uwf.store, payload.detail);
  const output = expandOutput(uwf, payload.output);
  const status =
    output !== null &&
    typeof output === "object" &&
    !Array.isArray(output) &&
    typeof (output as Record<string, unknown>).$status === "string"
      ? ((output as Record<string, unknown>).$status as string)
      : "";
  const startedAtMs =
    typeof payload.startedAtMs === "number" && Number.isFinite(payload.startedAtMs)
      ? payload.startedAtMs
      : null;
  const completedAtMs =
    typeof payload.completedAtMs === "number" && Number.isFinite(payload.completedAtMs)
      ? payload.completedAtMs
      : null;
  const durationMs =
    startedAtMs !== null && completedAtMs !== null && completedAtMs >= startedAtMs
      ? completedAtMs - startedAtMs
      : null;
  return {
    hash: stepHash,
    role: payload.role,
    agent: payload.agent,
    status,
    startedAtMs,
    completedAtMs,
    durationMs,
    usage: payload.usage ?? null,
    detail,
  };
}

/**
 * Fork a thread from a specific step (previously: thread fork)
 */
export async function cmdStepFork(
  storageRoot: string,
  stepHash: CasRef,
): Promise<ThreadForkOutput> {
  const uwf = await createUwfStore(storageRoot);
  const node = uwf.store.cas.get(stepHash);
  if (node === null) {
    fail(`CAS node not found: ${stepHash}`);
  }
  if (node.type !== uwf.schemas.startNode && node.type !== uwf.schemas.stepNode) {
    fail(`node ${stepHash} is not a StartNode or StepNode`);
  }

  const newThreadId = generateUlid(Date.now()) as ThreadId;
  setThread(uwf.varStore, newThreadId, {
    head: stepHash,
    status: "idle",
    suspendedRole: null,
    suspendMessage: null,
    completedAt: null,
  });

  return {
    thread: newThreadId,
    forkedFrom: {
      step: stepHash,
    },
  };
}

/**
 * Load and validate step detail node from CAS store
 */
function loadStepDetail(store: CasStore, detailRef: CasRef): Record<string, unknown> {
  const detailNode = store.get(detailRef);
  if (detailNode === null) {
    fail(`detail node not found: ${detailRef}`);
  }
  return detailNode.payload as Record<string, unknown>;
}

function parseTurnToolCalls(raw: unknown): TurnToolCall[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }
  const calls: TurnToolCall[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const name = record.name;
    const args = record.args;
    if (typeof name === "string") {
      calls.push({ name, args: typeof args === "string" ? args : "" });
    }
  }
  return calls.length > 0 ? calls : null;
}

function formatTurnBody(turn: TurnData): string {
  const parts: string[] = [];
  parts.push(`**Turn role:** ${turn.role}`);

  if (turn.toolCalls !== null) {
    for (const call of turn.toolCalls) {
      const argsSuffix = call.args !== "" ? ` — \`${call.args}\`` : "";
      parts.push(`- **${call.name}**${argsSuffix}`);
    }
  }

  if (turn.content !== "") {
    if (parts.length > 0) {
      parts.push("");
    }
    parts.push(turn.content);
  }

  return parts.join("\n");
}

function parseSingleTurn(
  store: CasStore,
  turnRef: unknown,
  fallbackIndex: number,
): TurnData | null {
  if (typeof turnRef !== "string") {
    return null;
  }
  const turnNode = store.get(turnRef as CasRef);
  if (turnNode === null) {
    return null;
  }
  const turn = turnNode.payload as Record<string, unknown>;
  const content = typeof turn.content === "string" ? turn.content : "";
  const toolCalls = parseTurnToolCalls(turn.toolCalls);
  if (content === "" && toolCalls === null) {
    return null;
  }
  return {
    index: typeof turn.index === "number" ? turn.index : fallbackIndex,
    role: typeof turn.role === "string" ? turn.role : "assistant",
    content,
    toolCalls,
  };
}

/**
 * Load all turn nodes from CAS store and extract display fields
 */
function loadTurnData(store: CasStore, turns: unknown): TurnData[] {
  if (!Array.isArray(turns) || turns.length === 0) {
    return [];
  }

  const turnData: TurnData[] = [];
  for (const turnRef of turns) {
    const parsed = parseSingleTurn(store, turnRef, turnData.length);
    if (parsed !== null) {
      turnData.push(parsed);
    }
  }
  return turnData;
}

/**
 * Select turns that fit within quota, working backwards from most recent
 */
function selectTurnsForQuota(turnData: TurnData[], availableQuota: number): TurnData[] {
  const selectedTurns: TurnData[] = [];
  let totalChars = 0;

  for (let i = turnData.length - 1; i >= 0; i--) {
    const turn = turnData[i];
    if (turn === undefined) continue;

    const turnHeader = `## Turn ${turn.index + 1}\n\n`;
    const turnBlock = turnHeader + formatTurnBody(turn);
    const separatorCost = selectedTurns.length > 0 ? 2 : 0;
    const addCost = turnBlock.length + separatorCost;

    if (totalChars + addCost > availableQuota && selectedTurns.length > 0) {
      break;
    }

    selectedTurns.unshift(turn);
    totalChars += addCost;
  }

  return selectedTurns;
}

/**
 * Assemble final markdown output from header and selected turns
 */
function formatStepMarkdown(
  stepHash: CasRef,
  role: string,
  agent: string,
  turnData: TurnData[],
  selectedTurns: TurnData[],
): string {
  const parts: string[] = [];
  parts.push(`# Step ${stepHash}`);
  parts.push("");
  parts.push(`**Role:** ${role}`);
  parts.push(`**Agent:** ${agent}`);

  if (selectedTurns.length === 0) {
    return parts.join("\n");
  }

  const skippedCount = turnData.length - selectedTurns.length;
  if (skippedCount > 0) {
    parts.push("");
    parts.push(`_[Earlier turns omitted due to quota. Use --quota to increase.]_`);
  }

  for (const turn of selectedTurns) {
    parts.push("");
    parts.push(`## Turn ${turn.index + 1}`);
    parts.push("");
    parts.push(formatTurnBody(turn));
  }

  return parts.join("\n");
}

/**
 * Read a step's agent turns as human-readable markdown with quota enforcement
 */
export async function cmdStepRead(
  storageRoot: string,
  stepHash: CasRef,
  quota: number,
  showPrompt: boolean,
): Promise<string> {
  const uwf = await createUwfStore(storageRoot);
  const node = uwf.store.cas.get(stepHash);
  if (node === null) {
    fail(`CAS node not found: ${stepHash}`);
  }
  if (node.type !== uwf.schemas.stepNode) {
    fail(`node ${stepHash} is not a StepNode`);
  }
  const payload = node.payload as StepNodePayload;

  // --prompt mode: show the assembled prompt that was sent to the agent
  if (showPrompt) {
    const promptRef = (payload as Record<string, unknown>).assembledPrompt;
    if (typeof promptRef !== "string") {
      return `# Step ${stepHash}\n\n_Prompt not recorded (legacy step)._`;
    }
    const promptNode = uwf.store.cas.get(promptRef as CasRef);
    if (promptNode === null) {
      return `# Step ${stepHash}\n\n_Prompt CAS node not found: ${promptRef}_`;
    }
    const promptText =
      typeof promptNode.payload === "string"
        ? promptNode.payload
        : JSON.stringify(promptNode.payload);
    return `# Step ${stepHash}\n\n**Role:** ${payload.role}\n**Agent:** ${payload.agent}\n\n## Prompt\n\n${promptText}`;
  }

  if (payload.detail === null) {
    return formatStepMarkdown(stepHash, payload.role, payload.agent, [], []);
  }

  const detail = loadStepDetail(uwf.store.cas, payload.detail);
  const turnData = loadTurnData(uwf.store.cas, detail.turns);

  if (turnData.length === 0) {
    return formatStepMarkdown(stepHash, payload.role, payload.agent, [], []);
  }

  const headerSection = formatStepMarkdown(stepHash, payload.role, payload.agent, [], []);
  const BUFFER = 200;
  const availableQuota = quota - headerSection.length - BUFFER;
  const selectedTurns = selectTurnsForQuota(turnData, availableQuota);

  return formatStepMarkdown(stepHash, payload.role, payload.agent, turnData, selectedTurns);
}

// ── step turns ────────────────────────────────────────────────────────────────
//
// Phase 4 (#400) — the consumer side of the realtime-turns RFC. Unlike
// `step read` (which addresses a settled StepNode by hash), `step turns` is keyed
// by `<thread-id>` + `--role` because the in-flight turn list lives in the
// `@uwf/active-turns/<threadId>/<role>` var while the step is still running.
//
// Read order: active var first (running step) → `detail.turns` fallback
// (completed step). Both sources are a `CasRef[]` of pure `{role, content}` turn
// nodes, so rendering reuses the SAME `loadTurnData` → `formatTurnBody` pipeline
// as `step read`.

/** Default poll interval for `--live` (ms). Small + fixed; injectable for tests. */
export const STEP_TURNS_POLL_INTERVAL_MS = 400;

export type CmdStepTurnsOptions = {
  /** Workflow role whose `(threadId, role)` active var / detail to read. */
  role: string;
  /** Follow the running step's active var, printing new turns as they arrive. */
  live: boolean;
  /** Poll interval override for `--live` (ms). Defaults to STEP_TURNS_POLL_INTERVAL_MS. */
  pollIntervalMs: number | null;
  /** Sink for `--live` incremental output. Defaults to stdout. */
  onChunk: ((chunk: string) => void) | null;
  /** Injectable sleep between `--live` poll ticks. Defaults to setTimeout. */
  sleep: ((ms: number) => Promise<void>) | null;
  /** Injectable running-step predicate for `--live`. Defaults to isThreadRunning. */
  isRunning: (() => Promise<boolean>) | null;
};

/** Fill optional CmdStepTurnsOptions fields with their runtime defaults. */
function resolveStepTurnsOptions(
  storageRoot: string,
  threadId: ThreadId,
  options: Partial<CmdStepTurnsOptions> & { role: string; live: boolean },
): CmdStepTurnsOptions {
  return {
    role: options.role,
    live: options.live,
    pollIntervalMs: options.pollIntervalMs ?? null,
    onChunk: options.onChunk ?? null,
    sleep: options.sleep ?? null,
    isRunning:
      options.isRunning ?? (async () => (await isThreadRunning(storageRoot, threadId)) !== null),
  };
}

/**
 * Resolve the completed step's `detail.turns` for a thread's head **scoped to a
 * role**, or `[]` when the head is a StartNode (no steps yet) / the head step
 * has no detail / the head step belongs to a *different* role than `role`.
 *
 * Role-awareness is the fix for review blocking issue #1/#2 (#400): a StepNode
 * carries the role that produced it (`StepNodePayload.role`), and on a
 * multi-role thread (e.g. `planner → coder`) the head step belongs to exactly
 * one role while the others' turns live on earlier steps (or never ran). The
 * fallback therefore surfaces the head step's `detail.turns` **only when**
 * `headStepNode.role === role`; on a mismatch it returns `[]` instead of
 * leaking the head step's turns under an unrelated `--role`. Never crashes for a
 * StartNode head — that is the legitimate "no turns yet" case.
 */
function readHeadDetailTurns(uwf: UwfStore, headHash: CasRef, role: string): CasRef[] {
  const node = uwf.store.cas.get(headHash);
  if (node === null || node.type !== uwf.schemas.stepNode) {
    return [];
  }
  const payload = node.payload as StepNodePayload;
  // Role-aware: the head step's turns belong to the head step's role only.
  if (payload.role !== role) {
    return [];
  }
  if (payload.detail === null) {
    return [];
  }
  const detailNode = uwf.store.cas.get(payload.detail);
  if (detailNode === null) {
    return [];
  }
  const detail = detailNode.payload as Record<string, unknown>;
  return Array.isArray(detail.turns) ? (detail.turns as CasRef[]) : [];
}

/**
 * Resolve the turn-hash list for `(threadId, role)` with active-var precedence:
 *   1. `readActiveTurns` — the in-flight step's live list (non-empty wins).
 *   2. else the thread head StepNode's immutable `detail.turns`, **but only when
 *      the head step's `role === role`** (role-aware fallback).
 */
function resolveTurnHashes(uwf: UwfStore, threadId: ThreadId, role: string): CasRef[] {
  const active = readActiveTurns(uwf.store, threadId, role);
  if (active.length > 0) {
    return active;
  }
  const entry = getThread(uwf.varStore, threadId);
  if (entry === null) {
    fail(`thread not found: ${threadId}`);
  }
  return readHeadDetailTurns(uwf, entry.head, role);
}

/** Render a single turn's `## Turn N` block (1-based) via the reused pipeline. */
function formatTurnBlock(turn: TurnData, displayIndex: number): string {
  return `## Turn ${displayIndex}\n\n${formatTurnBody(turn)}`;
}

/** Assemble the full (non-live) markdown for a resolved turn-hash list. */
function formatTurnsMarkdown(threadId: ThreadId, role: string, turnData: TurnData[]): string {
  const parts: string[] = [`# Thread ${threadId} (role: ${role})`];
  for (let i = 0; i < turnData.length; i++) {
    const turn = turnData[i];
    if (turn === undefined) continue;
    parts.push("");
    parts.push(formatTurnBlock(turn, i + 1));
  }
  return parts.join("\n");
}

/**
 * `--live` follower: poll the active var, printing each new turn block exactly
 * once (tracking how many blocks were emitted and rendering only the new tail).
 * Exits when the step completes — active var gone AND the thread is no longer
 * running. On exit it reconciles against the frozen `detail.turns` so a turn
 * appended in the same instant the var was solidified is not lost.
 */
async function followStepTurnsLive(
  storageRoot: string,
  threadId: ThreadId,
  opts: CmdStepTurnsOptions,
): Promise<void> {
  const emit = opts.onChunk ?? ((chunk: string) => process.stdout.write(chunk));
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const isRunning =
    opts.isRunning ?? (async () => (await isThreadRunning(storageRoot, threadId)) !== null);
  const intervalMs = opts.pollIntervalMs ?? STEP_TURNS_POLL_INTERVAL_MS;

  let printedCount = 0;
  // Print the new tail of `hashes` beyond what has already been emitted.
  const flush = (uwf: UwfStore, hashes: CasRef[]): void => {
    if (hashes.length <= printedCount) {
      return;
    }
    const tail = loadTurnData(uwf.store.cas, hashes.slice(printedCount));
    for (let i = 0; i < tail.length; i++) {
      const turn = tail[i];
      if (turn === undefined) continue;
      emit(`${formatTurnBlock(turn, printedCount + i + 1)}\n`);
    }
    printedCount = hashes.length;
  };

  while (true) {
    const uwf = await createUwfStore(storageRoot);
    const active = readActiveTurns(uwf.store, threadId, opts.role);
    flush(uwf, active);

    const running = await isRunning();
    if (!running) {
      // Step finished (or producer died). Reconcile so no turn is lost across
      // the active→detail handoff, then stop — never hang waiting for a var
      // that will not reappear.
      const remaining = readActiveTurns(uwf.store, threadId, opts.role);
      if (remaining.length > 0) {
        // Crash / not-yet-solidified: trust the live var; the head step detail
        // may belong to a different (previous) step, so don't fall back to it.
        flush(uwf, remaining);
      } else {
        // Normal completion: the var was solidified into the head step's
        // immutable detail.turns — flush any tail not already streamed. The
        // fallback is role-aware (issue #1/#2): in a multi-step run the head may
        // have advanced to a *different* role's step while the thread is still
        // "running"; passing `opts.role` ensures we only reconcile against the
        // followed role's head step (else `[]`), never the next role's turns.
        const entry = getThread(uwf.varStore, threadId);
        if (entry !== null) {
          flush(uwf, readHeadDetailTurns(uwf, entry.head, opts.role));
        }
      }
      return;
    }

    await sleep(intervalMs);
  }
}

/**
 * Resolve the default `--role` for `step turns <tid>` when none is given: the
 * role of the thread's head StepNode (the running / most-recent step). Falls
 * back to `"agent"` when the head is a StartNode (no steps yet) so a role is
 * always concrete before reading the per-role active var. Fails with the
 * standard `thread not found` message for an unknown thread.
 */
export async function resolveDefaultTurnsRole(
  storageRoot: string,
  threadId: ThreadId,
): Promise<string> {
  const uwf = await createUwfStore(storageRoot);
  const entry = getThread(uwf.varStore, threadId);
  if (entry === null) {
    fail(`thread not found: ${threadId}`);
  }
  const node = uwf.store.cas.get(entry.head);
  if (node !== null && node.type === uwf.schemas.stepNode) {
    return (node.payload as StepNodePayload).role;
  }
  return "agent";
}

/**
 * `uwf step turns <thread-id> [--role <r>] [--live]` — read a step's turns from
 * the active-turns var (running) with a `detail.turns` fallback (completed),
 * rendering through the same per-turn pipeline as `step read`. With `--live`,
 * follow the running step's active var, printing new turns incrementally.
 *
 * Returns the assembled markdown (non-live); for `--live` the output is streamed
 * to `onChunk`/stdout and the resolved string is returned empty.
 */
export async function cmdStepTurns(
  storageRoot: string,
  threadId: ThreadId,
  options: Partial<CmdStepTurnsOptions> & { role: string; live: boolean },
): Promise<string> {
  const opts = resolveStepTurnsOptions(storageRoot, threadId, options);

  if (opts.live) {
    await followStepTurnsLive(storageRoot, threadId, opts);
    return "";
  }

  const uwf = await createUwfStore(storageRoot);
  const hashes = resolveTurnHashes(uwf, threadId, opts.role);
  const turnData = loadTurnData(uwf.store.cas, hashes);
  return formatTurnsMarkdown(threadId, opts.role, turnData);
}

// ── step ask ────────────────────────────────────────────────────────────────
//
// Phase 3 (#380) — Option B: `step ask` is disabled while broker integration
// lands. The pre-broker spawn-agent path depended on the legacy
// `agents.<alias>: {command, args}` config shape; that shape was replaced by
// `{host, gateway}` and the equivalent broker `ask`/`fork` primitives are
// scheduled for Phase 4 (#381). The command exits non-zero with a clear
// migration pointer so existing scripts fail fast rather than silently.

export type CmdStepAskOptions = {
  prompt: string;
  agentOverride: string | null;
  /** When false, skip session forking and pass detail ref for context injection. */
  fork: boolean;
};

/**
 * `uwf step ask` is unavailable in 0.x while broker integration (#381) is in
 * progress. The legacy spawn-agent code path was removed alongside the
 * `agents.<alias>: {command, args}` config shape. Use `uwf thread exec` /
 * `uwf thread resume` instead — those routes go through `broker.send()` and
 * preserve the Sumeru session.
 */
export async function cmdStepAsk(
  _storageRoot: string,
  _stepHash: CasRef,
  _options: CmdStepAskOptions,
): Promise<string> {
  fail(
    "step ask is unavailable in 0.x while broker integration (#381) is in progress. " +
      "The pre-broker spawn-agent path was removed in #380; equivalent ask/fork primitives " +
      "will return in Phase 4 once the Sumeru broker exposes session-fork APIs. " +
      "Use `uwf thread resume <id> -p '...'` to continue a suspended thread, or " +
      "`uwf thread exec <id>` to advance an idle thread.",
  );
}
