import type { CasStore } from "@ocas/core";
import type {
  CasRef,
  StartEntry,
  StepEntry,
  StepNodePayload,
  StepStartPayload,
  ThreadForkOutput,
  ThreadId,
  ThreadStepsOutput,
  TurnNodePayload,
} from "@united-workforce/protocol";
import { createLogger, generateUlid } from "@united-workforce/util";
import { isThreadRunning } from "../background/index.js";
import {
  createUwfStore,
  getActiveStep,
  getActiveTurnHead,
  getThread,
  readActiveTurnRoles,
  readActiveTurns,
  setThread,
  turnsOfStep,
  type UwfStore,
} from "../store.js";
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
// Phase 4 (#400) / #409 — the consumer side of the realtime-turns RFC. `step
// turns <thread-id>` renders the **whole-thread turn panorama**: it walks the
// entire thread chain (reusing the SAME `walkChain` + `collectOrderedSteps`
// infrastructure as `cmdStepList`) and shows every step's turns in chronological
// order, each turn attributed to its owning role/step.
//
// Per-step turn sourcing (active-var precedence, scoped to each step's role):
//   - the in-flight step (its `@uwf/active-turns/<tid>/<role>` var still present)
//     → read the live active var and mark the step `🔄 进行中`;
//   - every completed step → read its own immutable `detail.turns` and mark `✓`.
// Both sources are a `CasRef[]` of pure `{role, content}` turn nodes, so per-turn
// rendering reuses the SAME `loadTurnData` → `formatTurnBody` pipeline as
// `step read` — a turn block here is byte-identical to `step read` for that step.
//
// `--role X` filters the panorama to that role's steps (across the whole chain);
// `--limit`/`--offset` paginate the flattened cross-step turn sequence (filter
// first, then paginate). Default is full, untruncated output. Because turns are
// always sourced per-step, role isolation (#408) falls out structurally — the
// head-only `readHeadDetailTurns` role-guard hack is obsolete.

/** Default poll interval for `--live` (ms). Small + fixed; injectable for tests. */
export const STEP_TURNS_POLL_INTERVAL_MS = 400;

export type CmdStepTurnsOptions = {
  /**
   * Chain-wide role filter: keep only steps whose `StepNodePayload.role` (and the
   * in-flight step whose active var) equals this role. `null` = no filter (show
   * every role's steps along the chain).
   */
  role: string | null;
  /** Follow the running step's active var, printing new turns as they arrive. */
  live: boolean;
  /** Pagination: max turns of the flattened cross-step sequence. `null` = no limit. */
  limit: number | null;
  /** Pagination: skip the first N turns of the flattened sequence. Defaults to 0. */
  offset: number;
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
  options: Partial<CmdStepTurnsOptions> & { live: boolean },
): CmdStepTurnsOptions {
  return {
    role: options.role ?? null,
    live: options.live,
    limit: options.limit ?? null,
    offset: options.offset ?? 0,
    pollIntervalMs: options.pollIntervalMs ?? null,
    onChunk: options.onChunk ?? null,
    sleep: options.sleep ?? null,
    isRunning:
      options.isRunning ?? (async () => (await isThreadRunning(storageRoot, threadId)) !== null),
  };
}

/**
 * Walk the thread chain from `headHash` and return the **newest** step whose
 * `role === role`'s immutable `detail.turns`, or `[]` when no step on the chain
 * has that role. Used by the `--live` exit reconcile to flush the followed role's
 * own solidified turns without ever surfacing a *different* role's turns: in a
 * multi-step run the head may have advanced past the followed step to another
 * role, so reconciling against `head` blindly (the pre-#409 `readHeadDetailTurns`)
 * could leak the next role's turns. Scoping to the followed role's own step on
 * the chain is the live counterpart of the non-live per-step sourcing.
 */
function readRoleDetailTurnsFromChain(uwf: UwfStore, headHash: CasRef, role: string): CasRef[] {
  let hash: CasRef | null = headHash;
  while (hash !== null) {
    const node = uwf.store.cas.get(hash);
    if (node === null || node.type !== uwf.schemas.stepNode) {
      break;
    }
    const payload = node.payload as StepNodePayload;
    if (payload.role === role) {
      return readStepDetailTurns(uwf, hash);
    }
    hash = payload.prev;
  }
  return [];
}

/**
 * Read a specific step's immutable `detail.turns` (the ordered `CasRef[]` of its
 * turn nodes). Returns `[]` for a non-StepNode, a step with no detail, or a
 * detail whose `turns` is absent/malformed. Unlike `readHeadDetailTurns` this is
 * role-agnostic — the caller already knows which step it is reading (the chain
 * walk attributes each step to its own role), so no head-role guard is needed.
 */
function readStepDetailTurns(uwf: UwfStore, stepHash: CasRef): CasRef[] {
  const node = uwf.store.cas.get(stepHash);
  if (node === null || node.type !== uwf.schemas.stepNode) {
    return [];
  }
  const payload = node.payload as StepNodePayload;
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
 * One step group in the whole-thread turn panorama: the owning role, whether the
 * step is still in flight (`running` → `🔄 进行中`, else `✓`), and its turns
 * (already materialized from CAS via `loadTurnData`).
 */
type TurnsPanoramaGroup = {
  role: string;
  running: boolean;
  turns: TurnData[];
  /** Step-start hash for this group (used internally for owner-based lookup). */
  stepStartHash: CasRef | null;
};

/**
 * Walk the step-start chain from a turn's owner backward via `prev` pointers.
 * Returns step-starts in chronological order (oldest first).
 */
function walkStepStartChain(uwf: UwfStore, turnHead: CasRef): CasRef[] {
  // First, find a step-start hash from any turn's owner
  const turnChain: CasRef[] = [];
  let currentTurn: CasRef | null = turnHead;

  // Walk the turn chain to find all unique owners
  const seenOwners = new Set<string>();
  const owners: CasRef[] = [];

  while (currentTurn !== null) {
    turnChain.push(currentTurn);
    const node = uwf.store.cas.get(currentTurn);
    if (node === null) break;

    const payload = node.payload as TurnNodePayload | { prev: CasRef | null; owner: CasRef | null };
    const owner = payload.owner ?? null;
    if (owner !== null && !seenOwners.has(owner)) {
      seenOwners.add(owner);
      owners.push(owner);
    }
    currentTurn = payload.prev ?? null;
  }

  // Now walk the step-start chain to get them in order
  // Find the newest step-start and walk backward via prev
  if (owners.length === 0) {
    return [];
  }

  // Use the owners we found and order by stepIndex
  const stepStartsWithIndex: { hash: CasRef; index: number }[] = [];
  for (const owner of owners) {
    const node = uwf.store.cas.get(owner);
    if (node === null || node.type !== uwf.schemas.stepStart) continue;
    const payload = node.payload as StepStartPayload;
    stepStartsWithIndex.push({ hash: owner, index: payload.stepIndex });
  }

  // Sort by stepIndex to get chronological order
  stepStartsWithIndex.sort((a, b) => a.index - b.index);
  return stepStartsWithIndex.map((s) => s.hash);
}

/**
 * Build the whole-thread turn panorama (#421 Phase 3): walk the step-start chain
 * (via turn owner → step-start → prev) and produce one group per step in
 * chronological order. Each turn is attributed to its owning step-start via the
 * `owner` field.
 *
 * Phase 3 changes (root-causing #412):
 *   - Walks step-start chain instead of role-keyed active vars
 *   - Each segment's turns sourced via `turnsOfStep(turnHead, stepStartHash)`
 *   - In-flight detection: active-step matches step-start AND no step-complete
 *   - edgePrompt readable directly from step-start
 *
 * In-flight step detection:
 *   1. Check if `@uwf/active-step/<threadId>` points to this step-start hash
 *   2. If match, this step is in-flight (no step-complete written yet)
 *
 * Fails with the standard `thread not found` message for an unknown thread.
 */
function buildTurnsPanorama(uwf: UwfStore, threadId: ThreadId): TurnsPanoramaGroup[] {
  const entry = getThread(uwf.varStore, threadId);
  if (entry === null) {
    fail(`thread not found: ${threadId}`);
  }

  // Get the turn chain head and active-step (if any)
  const turnHead = getActiveTurnHead(uwf.store, threadId);
  const activeStepHash = getActiveStep(uwf.store, threadId);

  // If no turns yet, try the legacy path via StepNode chain
  if (turnHead === null) {
    return buildTurnsPanoramaLegacy(uwf, threadId, entry.head);
  }

  // Walk the step-start chain from turn owners
  const stepStarts = walkStepStartChain(uwf, turnHead);
  const groups: TurnsPanoramaGroup[] = [];

  for (const stepStartHash of stepStarts) {
    const node = uwf.store.cas.get(stepStartHash);
    if (node === null || node.type !== uwf.schemas.stepStart) continue;

    const payload = node.payload as StepStartPayload;
    const role = payload.role;

    // Detect in-flight: active-step points to this step-start
    const isInFlight = activeStepHash === stepStartHash;

    // Get turns for this step using owner-based filtering
    const turnHashes = turnsOfStep(uwf, turnHead, stepStartHash);
    const turns = loadTurnData(uwf.store.cas, turnHashes);

    groups.push({
      role,
      running: isInFlight,
      turns,
      stepStartHash,
    });
  }

  return groups;
}

/**
 * Legacy fallback for threads without new turn chain structure.
 * Uses the old role-keyed active vars and StepNode detail.turns.
 */
function buildTurnsPanoramaLegacy(
  uwf: UwfStore,
  threadId: ThreadId,
  headHash: CasRef,
): TurnsPanoramaGroup[] {
  const chain = walkChain(uwf, headHash);
  const ordered = collectOrderedSteps(uwf, headHash, chain);
  const activeRoles = readActiveTurnRoles(uwf.store, threadId);
  const activeByRole = new Map(activeRoles.map((a) => [a.role, a.turns] as const));
  const consumed = new Set<string>();
  const groups: TurnsPanoramaGroup[] = [];

  for (const item of ordered) {
    const role = item.payload.role;
    const active = activeByRole.get(role);
    if (active !== undefined && active.length > 0 && !consumed.has(role)) {
      groups.push({
        role,
        running: true,
        turns: loadTurnData(uwf.store.cas, active),
        stepStartHash: null,
      });
      consumed.add(role);
    } else {
      groups.push({
        role,
        running: false,
        turns: loadTurnData(uwf.store.cas, readStepDetailTurns(uwf, item.hash)),
        stepStartHash: null,
      });
    }
  }

  for (const { role, turns } of activeRoles) {
    if (consumed.has(role)) {
      continue;
    }
    groups.push({
      role,
      running: true,
      turns: loadTurnData(uwf.store.cas, turns),
      stepStartHash: null,
    });
    consumed.add(role);
  }

  return groups;
}

/**
 * Filter the panorama to a single role (exact-match), or pass it through
 * unchanged when `role === null` (show every role's steps). `--role` is a filter
 * over the whole-chain panorama, so it keeps **all** steps of that role across
 * the thread (e.g. a role that ran in two rounds), not just the latest.
 */
function filterPanoramaByRole(
  groups: TurnsPanoramaGroup[],
  role: string | null,
): TurnsPanoramaGroup[] {
  if (role === null) {
    return groups;
  }
  return groups.filter((g) => g.role === role);
}

/** Render a single turn's `## Turn N` block (1-based) via the reused pipeline. */
function formatTurnBlock(turn: TurnData, displayIndex: number): string {
  return `## Turn ${displayIndex}\n\n${formatTurnBody(turn)}`;
}

/**
 * Slice the panorama's flattened cross-step turn sequence to `[offset, offset+limit)`
 * (`limit === null` → no upper bound, the OCAS `ListOptions` "no limit" convention),
 * keeping each surviving turn's **global** index so numbering is consistent across
 * the whole panorama. Returns per-group survivors paired with their group, so
 * grouping/markers are preserved while pagination removes turns (not steps).
 */
function paginatePanorama(
  groups: TurnsPanoramaGroup[],
  offset: number,
  limit: number | null,
): { group: TurnsPanoramaGroup; turns: { turn: TurnData; globalIndex: number }[] }[] {
  const start = offset > 0 ? offset : 0;
  const end = limit === null ? Number.POSITIVE_INFINITY : start + Math.max(0, limit);
  let globalIndex = 0;
  const result: {
    group: TurnsPanoramaGroup;
    turns: { turn: TurnData; globalIndex: number }[];
  }[] = [];
  for (const group of groups) {
    const survivors: { turn: TurnData; globalIndex: number }[] = [];
    for (const turn of group.turns) {
      const idx = globalIndex;
      globalIndex += 1;
      if (idx >= start && idx < end) {
        survivors.push({ turn, globalIndex: idx });
      }
    }
    result.push({ group, turns: survivors });
  }
  return result;
}

/** Step group header, e.g. `## developer ✓ (47 turns)` / `## reviewer 🔄 进行中 (12 turns so far)`. */
function formatGroupHeader(group: TurnsPanoramaGroup): string {
  const count = group.turns.length;
  if (group.running) {
    return `## ${group.role} 🔄 进行中 (${count} turns so far)`;
  }
  return `## ${group.role} ✓ (${count} turns)`;
}

/**
 * Assemble the whole-thread turn panorama markdown (#409): a thread header, then
 * one group per step (role + `✓`/`🔄 进行中` marker + turn count), and under each
 * the surviving turns rendered via the reused `formatTurnBlock` pipeline with
 * their global (cross-step) turn numbers. A group whose turns are entirely sliced
 * out by pagination still shows its header (zero turns beneath).
 */
function formatPanoramaMarkdown(
  threadId: ThreadId,
  groups: TurnsPanoramaGroup[],
  offset: number,
  limit: number | null,
): string {
  const parts: string[] = [`# Thread ${threadId}`];
  const paged = paginatePanorama(groups, offset, limit);
  for (const { group, turns } of paged) {
    parts.push("");
    parts.push(formatGroupHeader(group));
    for (const { turn, globalIndex } of turns) {
      parts.push("");
      parts.push(formatTurnBlock(turn, globalIndex + 1));
    }
  }
  return parts.join("\n");
}

/**
 * Resolve the turn hashes to flush when the followed step finishes (active var
 * gone AND thread no longer running). Phase 3: uses active-turn-head and owner
 * filtering via turnsOfStep. Falls back to legacy role-keyed vars if no turn
 * chain exists.
 */
function resolveFinalTurnHashesPhase3(
  uwf: UwfStore,
  threadId: ThreadId,
  activeStepStart: CasRef | null,
): CasRef[] {
  const turnHead = getActiveTurnHead(uwf.store, threadId);
  if (turnHead !== null && activeStepStart !== null) {
    return turnsOfStep(uwf, turnHead, activeStepStart);
  }
  // Fallback: no new turn chain, return empty
  return [];
}

/**
 * Legacy fallback for resolveFinalTurnHashes when thread uses role-keyed vars.
 */
function resolveFinalTurnHashesLegacy(
  uwf: UwfStore,
  threadId: ThreadId,
  followRole: string,
): CasRef[] {
  const remaining = readActiveTurns(uwf.store, threadId, followRole);
  if (remaining.length > 0) {
    return remaining;
  }
  const entry = getThread(uwf.varStore, threadId);
  if (entry === null) {
    return [];
  }
  return readRoleDetailTurnsFromChain(uwf, entry.head, followRole);
}

/**
 * Get turns for the in-flight step using Phase 3 owner-based filtering.
 * Returns turn hashes owned by the active step-start.
 */
function getInFlightTurns(uwf: UwfStore, threadId: ThreadId): CasRef[] {
  const turnHead = getActiveTurnHead(uwf.store, threadId);
  const activeStepStart = getActiveStep(uwf.store, threadId);

  if (turnHead === null || activeStepStart === null) {
    return [];
  }

  return turnsOfStep(uwf, turnHead, activeStepStart);
}

/**
 * Check if thread uses Phase 3 turn chain (has active-turn-head var).
 */
function hasPhase3TurnChain(uwf: UwfStore, threadId: ThreadId): boolean {
  return (
    getActiveTurnHead(uwf.store, threadId) !== null || getActiveStep(uwf.store, threadId) !== null
  );
}

/** State for live follower's flush operation. */
type LiveFollowerState = {
  printedCount: number;
  lastActiveStepStart: CasRef | null;
  usePhase3: boolean | null;
};

/** Get active turns based on Phase 3 vs legacy mode. */
function getActiveTurnsForLive(
  uwf: UwfStore,
  threadId: ThreadId,
  state: LiveFollowerState,
  followRole: string,
): CasRef[] {
  if (state.usePhase3) {
    const activeStepStart = getActiveStep(uwf.store, threadId);
    if (activeStepStart !== null) {
      state.lastActiveStepStart = activeStepStart;
    }
    return getInFlightTurns(uwf, threadId);
  }
  return readActiveTurns(uwf.store, threadId, followRole);
}

/** Get final turns for reconciliation based on Phase 3 vs legacy mode. */
function getFinalTurnsForLive(
  uwf: UwfStore,
  threadId: ThreadId,
  state: LiveFollowerState,
  followRole: string,
): CasRef[] {
  if (state.usePhase3) {
    return resolveFinalTurnHashesPhase3(uwf, threadId, state.lastActiveStepStart);
  }
  return resolveFinalTurnHashesLegacy(uwf, threadId, followRole);
}

/**
 * `--live` follower: poll the in-flight step's turns via the Phase 3 turn chain,
 * printing each new turn block exactly once (tracking how many blocks were emitted
 * and rendering only the new tail).
 *
 * Phase 3 changes (#421):
 *   - Uses `getActiveTurnHead` and `getActiveStep` instead of role-keyed vars
 *   - Filters turns via `turnsOfStep(turnHead, activeStepStart)`
 *   - Exits when the thread is no longer running
 *
 * Backward compatible: Falls back to legacy role-keyed vars for threads without
 * Phase 3 turn chain.
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
  const followRole = opts.role ?? (await resolveLiveFollowRole(storageRoot, threadId));

  const state: LiveFollowerState = {
    printedCount: 0,
    lastActiveStepStart: null,
    usePhase3: null,
  };

  const flush = (uwf: UwfStore, hashes: CasRef[]): void => {
    if (hashes.length <= state.printedCount) {
      return;
    }
    const tail = loadTurnData(uwf.store.cas, hashes.slice(state.printedCount));
    for (let i = 0; i < tail.length; i++) {
      const turn = tail[i];
      if (turn === undefined) continue;
      emit(`${formatTurnBlock(turn, state.printedCount + i + 1)}\n`);
    }
    state.printedCount = hashes.length;
  };

  while (true) {
    const uwf = await createUwfStore(storageRoot);

    if (state.usePhase3 === null) {
      state.usePhase3 = hasPhase3TurnChain(uwf, threadId);
    }

    const active = getActiveTurnsForLive(uwf, threadId, state, followRole);
    flush(uwf, active);

    const running = await isRunning();
    if (!running) {
      flush(uwf, getFinalTurnsForLive(uwf, threadId, state, followRole));
      return;
    }

    await sleep(intervalMs);
  }
}

/**
 * Resolve the role for `--live` to follow when `--role` is omitted: the thread's
 * current in-flight role. Prefers a role with a live `@uwf/active-turns` var
 * (the genuinely in-flight step); falls back to the head StepNode's role, then to
 * `"agent"` for a StartNode head. Fails with the standard `thread not found`
 * message for an unknown thread.
 */
async function resolveLiveFollowRole(storageRoot: string, threadId: ThreadId): Promise<string> {
  const uwf = await createUwfStore(storageRoot);
  const entry = getThread(uwf.varStore, threadId);
  if (entry === null) {
    fail(`thread not found: ${threadId}`);
  }
  const activeRoles = readActiveTurnRoles(uwf.store, threadId);
  const lastActive = activeRoles[activeRoles.length - 1];
  if (lastActive !== undefined) {
    return lastActive.role;
  }
  const node = uwf.store.cas.get(entry.head);
  if (node !== null && node.type === uwf.schemas.stepNode) {
    return (node.payload as StepNodePayload).role;
  }
  return "agent";
}

/**
 * `uwf step turns <thread-id> [--role <r>] [--live] [--limit <n>] [--offset <m>]`
 * — render the whole-thread turn panorama (#409): walk the entire chain and show
 * every step's turns (each completed step from its immutable `detail.turns`, the
 * in-flight step from its active var, marked `🔄 进行中`), through the same
 * per-turn pipeline as `step read`. `--role` filters the panorama to one role;
 * `--limit`/`--offset` paginate the flattened cross-step turn sequence (after the
 * role filter). With `--live`, follow the in-flight step's active var, printing
 * new turns incrementally.
 *
 * Returns the assembled markdown (non-live); for `--live` the output is streamed
 * to `onChunk`/stdout and the resolved string is returned empty.
 */
export async function cmdStepTurns(
  storageRoot: string,
  threadId: ThreadId,
  options: Partial<CmdStepTurnsOptions> & { live: boolean },
): Promise<string> {
  const opts = resolveStepTurnsOptions(storageRoot, threadId, options);

  if (opts.live) {
    await followStepTurnsLive(storageRoot, threadId, opts);
    return "";
  }

  const uwf = await createUwfStore(storageRoot);
  const panorama = buildTurnsPanorama(uwf, threadId);
  const filtered = filterPanoramaByRole(panorama, opts.role);
  return formatPanoramaMarkdown(threadId, filtered, opts.offset, opts.limit);
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
