/**
 * Broker-driven step execution. Replaces the legacy `spawnAgent` /
 * `executeAgentCommand` / last-stdout-line JSON parsing path with
 * `broker.send()` over the Sumeru HTTP API.
 *
 * Phase 3 (#380) — `cmdThreadStepOnce`, `cmdThreadResume`, and `cmdThreadPoke`
 * use this module instead of spawning per-role CLI binaries.
 */

import { join } from "node:path";
import { putSchema, validate } from "@ocas/core";
import {
  type AgentRoute,
  type BrokerTurn,
  createBroker,
  createSessionStore,
  type SendResult,
  type SessionStore,
} from "@united-workforce/broker";
import type {
  AgentAlias,
  AgentConfig,
  CasRef,
  StartNodePayload,
  StepContext,
  StepNodePayload,
  ThreadId,
  Usage,
  WorkflowConfig,
  WorkflowPayload,
} from "@united-workforce/protocol";
import { createLogger, type ProcessLogger } from "@united-workforce/util";
import {
  buildContinuationPrompt,
  buildFrontmatterRetryPrompt,
  buildOutputFormatInstruction,
  buildRolePrompt,
  buildThreadProgress,
  mergeUsage,
  tryFrontmatterFastPath,
  trySuspendFastPath,
} from "@united-workforce/util-agent";
import {
  clearActiveStep,
  clearActiveTurns,
  getActiveTurnHead,
  setActiveStep,
  setActiveTurnHead,
  type UwfStore,
  writeStepStart,
  writeTurnNode,
} from "../store.js";
import { expandOutput, fail } from "./shared.js";

const log = createLogger({ sink: { kind: "stderr" } });

/** Tag for broker.send call site. */
const PL_BROKER_SEND = "BR0KR5ND";
/** Tag for frontmatter retry call sites. */
const PL_FRONTMATTER_RETRY = "F4RTM4RT";
/** Tag for frontmatter extraction failure. */
const PL_FRONTMATTER_FAIL = "F4FA117Z";

const MAX_FRONTMATTER_RETRIES = 2;

const DETAIL_SCHEMA = {
  title: "broker-detail",
  type: "object" as const,
  required: ["sessionId", "duration", "turnCount"],
  properties: {
    sessionId: { type: "string" as const },
    duration: { type: "integer" as const },
    turnCount: { type: "integer" as const },
  },
  additionalProperties: false,
};

/** Result returned by `executeBrokerStep` — mirrors the legacy AdapterOutput surface. */
export type BrokerStepResult = {
  stepHash: CasRef;
  detailHash: CasRef;
  role: string;
  frontmatter: Record<string, unknown>;
  body: string;
  startedAtMs: number;
  completedAtMs: number;
  usage: Usage | null;
  isError: boolean;
  errorMessage: string | null;
};

/**
 * Parse `--agent` overrides under the new `{host, gateway}` shape.
 *
 * Accepts:
 *   - alias    e.g. `hermes`             → `config.agents.hermes`
 *   - inline   e.g. `http://h:7900 gw`   → `{host: "http://h:7900", gateway: "gw"}`
 *
 * Single-token forms that don't match an alias fail with the documented
 * message; this fully replaces the legacy "treat anything as a binary path"
 * behaviour.
 */
export function parseAgentOverride(override: string): AgentConfig {
  const trimmed = override.trim();
  if (trimmed === "") {
    fail("agent override must not be empty");
  }
  const parts = trimmed.split(/\s+/).filter((p) => p.length > 0);
  if (parts.length !== 2) {
    fail(`agent override must be an alias or "<host> <gateway>"`);
  }
  const host = parts[0];
  const gateway = parts[1];
  if (host === undefined || gateway === undefined) {
    fail(`agent override must be an alias or "<host> <gateway>"`);
  }
  return { host, gateway };
}

/**
 * Resolve the agent route for a (workflow, role, override) triple.
 * Mirrors the legacy `resolveAgentConfig` precedence:
 *   --agent override > agentOverrides[workflow][role] > defaultAgent
 * Override may be an alias or an inline `"<host> <gateway>"` form.
 */
export function resolveAgentRoute(
  config: WorkflowConfig,
  workflow: WorkflowPayload,
  role: string,
  agentOverride: string | null,
  cwd: string | null,
): AgentRoute {
  if (agentOverride !== null) {
    const fromAlias = config.agents[agentOverride as AgentAlias];
    if (fromAlias !== undefined) {
      return { host: fromAlias.host, gateway: fromAlias.gateway, cwd };
    }
    const parsed = parseAgentOverride(agentOverride);
    return { host: parsed.host, gateway: parsed.gateway, cwd };
  }

  let alias: AgentAlias = config.defaultAgent;
  if (config.agentOverrides !== null) {
    const roleOverrides = config.agentOverrides[workflow.name];
    if (roleOverrides !== undefined && roleOverrides[role] !== undefined) {
      alias = roleOverrides[role];
    }
  }

  const agentConfig = config.agents[alias];
  if (agentConfig === undefined) {
    fail(`unknown agent alias in config: ${alias}`);
  }
  return { host: agentConfig.host, gateway: agentConfig.gateway, cwd };
}

/**
 * Path to the broker session store DB under the storage root. Mirrors the
 * default used by `createSessionStore` but anchored at the user's `UWF_HOME`
 * so multi-process scripts share the same SQLite file.
 */
export function brokerSessionStorePath(storageRoot: string): string {
  return join(storageRoot, "broker", "sessions.db");
}

/**
 * Open (or create) the broker session store under `<storageRoot>/broker/sessions.db`.
 * The caller is responsible for closing it.
 */
export function openBrokerSessionStore(storageRoot: string): SessionStore {
  return createSessionStore({ dbPath: brokerSessionStorePath(storageRoot) });
}

/**
 * Look up the role's frontmatter / output schema in CAS so we can drive
 * `tryFrontmatterFastPath`.  The workflow payload only carries the schema's
 * CAS hash; the JSON Schema itself lives in CAS via `WorkflowAdd`.
 */
function loadRoleSchemaHash(workflow: WorkflowPayload, role: string): CasRef {
  const roleDef = workflow.roles[role];
  if (roleDef === undefined) {
    fail(`unknown role "${role}" in workflow "${workflow.name}"`);
  }
  return roleDef.frontmatter as CasRef;
}

/**
 * Build the output-format instruction for a role from its frontmatter schema in
 * CAS. Returns an empty string when the schema node is missing.
 */
function loadOutputFormatInstruction(uwf: UwfStore, schemaHash: CasRef): string {
  const node = uwf.store.cas.get(schemaHash);
  if (node === null) {
    return "";
  }
  return buildOutputFormatInstruction(node.payload as Record<string, unknown>);
}

/** Extract the last assistant turn's content from a detail node, or null. */
function extractStepContent(uwf: UwfStore, detailRef: CasRef): string | null {
  const detailNode = uwf.store.cas.get(detailRef);
  if (detailNode === null) {
    return null;
  }
  const detail = detailNode.payload as Record<string, unknown>;
  const turns = detail.turns;
  if (!Array.isArray(turns) || turns.length === 0) {
    return null;
  }
  for (let i = turns.length - 1; i >= 0; i--) {
    const turnRef = turns[i];
    if (typeof turnRef !== "string") {
      continue;
    }
    const turnNode = uwf.store.cas.get(turnRef as CasRef);
    if (turnNode === null) {
      continue;
    }
    const turn = turnNode.payload as Record<string, unknown>;
    if (
      turn.role === "assistant" &&
      typeof turn.content === "string" &&
      turn.content.trim() !== ""
    ) {
      return turn.content;
    }
  }
  return null;
}

/**
 * Walk the CAS step chain from `prevHash` back to the StartNode and return the
 * steps in chronological order (oldest first) as StepContext records. Honors the
 * caller-supplied `prev` pointer so poke replace-semantics (prev = old head's
 * prev) produce the correct history. Mirrors the history assembly in
 * util-agent's `buildContext`, but reuses the store the CLI already opened.
 */
function collectStepContexts(uwf: UwfStore, prevHash: CasRef | null): StepContext[] {
  const newestFirst: StepNodePayload[] = [];
  let hash: CasRef | null = prevHash;
  while (hash !== null) {
    const node = uwf.store.cas.get(hash);
    if (node === null || node.type !== uwf.schemas.stepNode) {
      break;
    }
    const payload = node.payload as StepNodePayload;
    newestFirst.push(payload);
    hash = payload.prev;
  }

  const chronological = [...newestFirst].reverse();
  return chronological.map((step) => ({
    role: step.role,
    output: expandOutput(uwf, step.output),
    detail: step.detail,
    agent: step.agent,
    edgePrompt: step.edgePrompt ?? "",
    startedAtMs: step.startedAtMs,
    completedAtMs: step.completedAtMs,
    cwd: step.cwd ?? "",
    assembledPrompt: step.assembledPrompt ?? null,
    usage: step.usage ?? null,
    previousAttempts: step.previousAttempts ?? null,
    content: extractStepContent(uwf, step.detail),
  }));
}

export type AssembleBrokerPromptArgs = {
  workflow: WorkflowPayload;
  role: string;
  threadId: ThreadId;
  /** The thread's initial task prompt (StartNode.prompt). */
  startPrompt: string;
  /** Prior steps in chronological order (oldest first). */
  steps: StepContext[];
  /** Moderator edge prompt that routed to this step. */
  edgePrompt: string;
  /** Frontmatter deliverable-format instruction for the role's output schema. */
  outputFormatInstruction: string;
};

/**
 * Assemble the full agent prompt for a broker step. Combines the five
 * components the legacy agent-CLI path produced (output-format instruction,
 * thread progress, role prompt, task prompt, and continuation/edge context) so
 * `broker.send()` receives the same context the spawned-agent path did.
 *
 * Mirrors `buildClaudeCodePrompt` from the agent-claude-code adapter.
 */
export function assembleBrokerPrompt(args: AssembleBrokerPromptArgs): string {
  const roleDef = args.workflow.roles[args.role];
  const rolePrompt = roleDef !== undefined ? buildRolePrompt(roleDef) : "";
  const isFirstVisit = !args.steps.some((s) => s.role === args.role);

  const parts: string[] = [];

  if (args.outputFormatInstruction !== "") {
    parts.push(args.outputFormatInstruction, "");
  }

  // Inject thread progress so the agent knows step count and role visit count.
  parts.push(buildThreadProgress(args.steps, args.role, args.threadId), "");

  parts.push(rolePrompt, "", "## Task", args.startPrompt);

  if (!isFirstVisit) {
    // Re-entry (broker resumes the cached session): show only steps since the
    // last visit, meta only.
    parts.push("", buildContinuationPrompt(args.steps, args.role, args.edgePrompt));
  } else if (args.steps.length > 0) {
    // First visit with prior history: show steps with content for recent ones.
    parts.push(
      "",
      buildContinuationPrompt(args.steps, args.role, args.edgePrompt, {
        includeContent: true,
        quota: 32000,
      }),
    );
  } else {
    parts.push("", "## Current Instruction", "", args.edgePrompt);
  }

  return parts.join("\n");
}

/**
 * Persist the step's detail node. Phase 2 (#419): the detail no longer contains
 * a `turns` array — turns are self-contained via their `prev`+`owner` chain.
 * Only metadata (sessionId, duration, turnCount) is stored.
 */
async function storeBrokerDetail(
  uwf: UwfStore,
  result: SendResult,
  threadId: ThreadId,
  role: string,
  startedAtMs: number,
  completedAtMs: number,
  turnCount: number,
): Promise<CasRef> {
  const detailSchemaHash = await putSchema(uwf.store, DETAIL_SCHEMA);

  // Phase 2 (#419): clear the deprecated role-keyed active var for backward
  // compatibility. The turns are already persisted via the turn chain.
  clearActiveTurns(uwf.store, threadId, role);

  const detail = {
    sessionId: result.sessionId,
    duration: Math.max(0, completedAtMs - startedAtMs),
    turnCount,
  };
  return uwf.store.cas.put(detailSchemaHash, detail);
}

/**
 * Build the realtime `onTurn` callback wired into `broker.send` (Phase 2, #419).
 * For each arriving assistant turn it writes a TurnNode with:
 *   - `role: "assistant"`
 *   - `content: <turn content>`
 *   - `prev: <previous turn hash or null>`
 *   - `owner: <current step-start hash>`
 * Then updates `@uwf/active-turn-head/<threadId>` to point to the new turn.
 *
 * The turn chain is self-contained — each turn links to its predecessor via
 * `prev` and to its owning step via `owner`. No separate array accumulation
 * is needed.
 *
 * Returns the turn count after the step completes (for detail node).
 */
function makeOnTurn(
  uwf: UwfStore,
  threadId: ThreadId,
  stepStartHash: CasRef,
): { onTurn: (turn: BrokerTurn) => void; getTurnCount: () => number } {
  let turnCount = 0;
  // Get the current turn head before this step starts (could be from previous steps)
  let prevTurnHash: CasRef | null = getActiveTurnHead(uwf.store, threadId);

  const onTurn = (turn: BrokerTurn): void => {
    // Write turn node with prev+owner chain
    const turnHash = writeTurnNode(uwf, {
      role: "assistant",
      content: turn.content,
      prev: prevTurnHash,
      owner: stepStartHash,
    });

    // Update thread-keyed active turn head
    setActiveTurnHead(uwf.store, threadId, turnHash);

    // Also maintain deprecated role-keyed var for backward compatibility
    // during transition period (can be removed in Phase 3)
    // appendActiveTurn is called but we don't rely on it for turn retrieval

    prevTurnHash = turnHash;
    turnCount++;
  };

  const getTurnCount = (): number => turnCount;

  return { onTurn, getTurnCount };
}

type WriteStepNodeArgs = {
  uwf: UwfStore;
  startHash: CasRef;
  prevHash: CasRef | null;
  role: string;
  outputHash: CasRef;
  detailHash: CasRef;
  agentName: string;
  edgePrompt: string;
  startedAtMs: number;
  completedAtMs: number;
  cwd: string;
  assembledPromptHash: CasRef | null;
  usage: Usage | null;
  previousAttempts: CasRef[] | null;
};

/** Persist a StepNode payload and verify it round-trips through schema validation. */
async function writeBrokerStepNode(args: WriteStepNodeArgs): Promise<CasRef> {
  const payload: StepNodePayload = {
    start: args.startHash,
    prev: args.prevHash,
    role: args.role,
    output: args.outputHash,
    detail: args.detailHash,
    agent: args.agentName,
    edgePrompt: args.edgePrompt,
    startedAtMs: args.startedAtMs,
    completedAtMs: args.completedAtMs,
    cwd: args.cwd,
    assembledPrompt: args.assembledPromptHash,
    usage: args.usage,
    previousAttempts: args.previousAttempts,
  };
  const hash = await args.uwf.store.cas.put(args.uwf.schemas.stepNode, payload);
  const node = args.uwf.store.cas.get(hash);
  if (node === null || !validate(args.uwf.store, node)) {
    fail("broker step persisted a StepNode that failed schema validation");
  }
  return hash;
}

type ExtractOutcome = {
  outputHash: CasRef;
  frontmatter: Record<string, unknown>;
  body: string;
};

async function tryExtract(
  uwf: UwfStore,
  rawOutput: string,
  outputSchema: CasRef,
): Promise<ExtractOutcome | null> {
  // `$status: "$SUSPEND"` is a reserved coroutine yield — store it against the
  // suspend schema, bypassing the role's own frontmatter schema.
  const suspend = await trySuspendFastPath(rawOutput, uwf.schemas.suspendOutput, uwf.store);
  if (suspend !== null) {
    return { outputHash: suspend.outputHash, frontmatter: suspend.frontmatter, body: suspend.body };
  }
  const fastPath = await tryFrontmatterFastPath(rawOutput, outputSchema, uwf.store);
  if (fastPath !== null) {
    return {
      outputHash: fastPath.outputHash,
      frontmatter: fastPath.frontmatter,
      body: fastPath.body,
    };
  }
  return null;
}

/**
 * Inputs for `executeBrokerStep`. The CLI pre-resolves the chain start, head,
 * and workflow so this function only worries about the broker exchange + CAS
 * write path.
 */
export type ExecuteBrokerStepArgs = {
  storageRoot: string;
  uwf: UwfStore;
  config: WorkflowConfig;
  workflow: WorkflowPayload;
  threadId: ThreadId;
  role: string;
  edgePrompt: string;
  effectiveCwd: string;
  startHash: CasRef;
  prevHash: CasRef | null;
  agentOverride: string | null;
  previousAttempts: CasRef[] | null;
  plog: ProcessLogger;
};

/**
 * Drive one moderator-resolved role through `broker.send()`, frontmatter
 * extraction (with retries on the same Sumeru session), and StepNode
 * persistence. Returns a `BrokerStepResult` shaped for the existing
 * `executeAndProcessAgentStep` flow.
 *
 * Phase 2 (#419) changes:
 *   - Writes step-start node at entry, sets `@uwf/active-step/<threadId>`
 *   - Turns are written with `prev`+`owner` chain via `writeTurnNode`
 *   - Updates `@uwf/active-turn-head/<threadId>` as turns arrive
 *   - Clears `@uwf/active-step/<threadId>` at completion
 *   - Detail node no longer contains `turns` array (turns self-contained)
 *
 * Side effects:
 *   - inserts a row in the broker session store keyed by (threadId, role)
 *   - writes step-start / turns / detail / StepNode to CAS
 *   - on extraction failure, persists an error StepNode (isError=true)
 */
export async function executeBrokerStep(args: ExecuteBrokerStepArgs): Promise<BrokerStepResult> {
  const sessionStore = openBrokerSessionStore(args.storageRoot);

  try {
    const route = resolveAgentRoute(
      args.config,
      args.workflow,
      args.role,
      args.agentOverride,
      args.effectiveCwd === "" ? null : args.effectiveCwd,
    );

    const broker = createBroker({
      sessionStore,
      resolveRoute: () => route,
      clientFactory: null,
    });

    args.plog.log(
      PL_BROKER_SEND,
      `broker.send role=${args.role} host=${route.host} gateway=${route.gateway}`,
      null,
    );

    // Assemble the full agent prompt (output-format instruction + thread
    // progress + role prompt + task + continuation/edge context) so the broker
    // path sends the same context the legacy spawned-agent path did, rather than
    // the bare edge prompt.
    const outputSchemaHash = loadRoleSchemaHash(args.workflow, args.role);
    const outputFormatInstruction = loadOutputFormatInstruction(args.uwf, outputSchemaHash);
    const startNode = args.uwf.store.cas.get(args.startHash);
    const startPrompt = startNode !== null ? (startNode.payload as StartNodePayload).prompt : "";
    const steps = collectStepContexts(args.uwf, args.prevHash);
    const assembledPrompt = assembleBrokerPrompt({
      workflow: args.workflow,
      role: args.role,
      threadId: args.threadId,
      startPrompt,
      steps,
      edgePrompt: args.edgePrompt,
      outputFormatInstruction,
    });
    const assembledPromptHash = (await args.uwf.store.cas.put(
      args.uwf.schemas.text,
      assembledPrompt,
    )) as CasRef;

    const startedAtMs = Date.now();

    // Phase 2 (#419): Write step-start node at entry
    const stepStartHash = writeStepStart(args.uwf, {
      role: args.role,
      edgePrompt: args.edgePrompt,
      stepIndex: steps.length,
      prev: args.prevHash,
      start: args.startHash,
      startedAtMs,
      cwd: args.effectiveCwd,
    });

    // Set the active-step var so other processes can detect in-flight state
    setActiveStep(args.uwf.store, args.threadId, stepStartHash);

    // Start-of-step clear (Phase 2, #398): a crash-rerun is a fresh attempt, so
    // any residual active var from a failed prior attempt is dropped here —
    // before any onTurn can fire — rather than appended onto. The clear is
    // start-of-step only (NOT per-send): frontmatter retries below re-send on
    // the cached session and must keep appending to the same attempt's var.
    clearActiveTurns(args.uwf.store, args.threadId, args.role);

    // Phase 2 (#419): makeOnTurn now writes turns with prev+owner chain
    const { onTurn, getTurnCount } = makeOnTurn(args.uwf, args.threadId, stepStartHash);

    const primary = await broker.send({
      threadId: args.threadId,
      role: args.role,
      prompt: assembledPrompt,
      onTurn,
    });

    let extracted = await tryExtract(args.uwf, primary.output, outputSchemaHash);
    let accumulatedUsage: Usage | null = brokerUsage(primary);
    let lastOutput = primary.output;
    let lastSessionId = primary.sessionId;

    // Retry on the same (threadId, role) — the broker re-uses the cached
    // Sumeru session, so the agent gets to "fix its frontmatter" with full
    // context preserved. Retries carry the same onTurn and keep appending to
    // the same attempt's active var (no clear between retries).
    for (let retry = 0; retry < MAX_FRONTMATTER_RETRIES && extracted === null; retry++) {
      const correctionPrompt = buildFrontmatterRetryPrompt(outputFormatInstruction);
      log(
        PL_FRONTMATTER_RETRY,
        `frontmatter retry ${retry + 1}/${MAX_FRONTMATTER_RETRIES} thread=${args.threadId} role=${args.role}`,
      );
      const retryResult = await broker.send({
        threadId: args.threadId,
        role: args.role,
        prompt: correctionPrompt,
        onTurn,
      });
      lastOutput = retryResult.output;
      lastSessionId = retryResult.sessionId;
      accumulatedUsage = mergeUsage(accumulatedUsage, brokerUsage(retryResult));
      extracted = await tryExtract(args.uwf, lastOutput, outputSchemaHash);
    }

    const completedAtMs = Date.now();

    // Phase 2 (#419): Pass turn count to detail (no longer from active var)
    const detailHash = await storeBrokerDetail(
      args.uwf,
      { ...primary, output: lastOutput, sessionId: lastSessionId },
      args.threadId,
      args.role,
      startedAtMs,
      completedAtMs,
      getTurnCount(),
    );

    // Phase 2 (#419): Clear active-step var on completion
    clearActiveStep(args.uwf.store, args.threadId);

    if (extracted === null) {
      log(
        PL_FRONTMATTER_FAIL,
        `frontmatter extraction failed after ${MAX_FRONTMATTER_RETRIES} retries thread=${args.threadId} role=${args.role}`,
      );
      const errorMessage =
        "Agent output does not contain valid YAML frontmatter matching the role schema " +
        `after ${MAX_FRONTMATTER_RETRIES} retries.\n` +
        `Raw output (first 500 chars): ${lastOutput.slice(0, 500)}`;
      const errorPayload = {
        $status: "error" as const,
        error: errorMessage,
        phase: "frontmatter_extraction" as const,
      };
      const errorOutputHash = await args.uwf.store.cas.put(
        args.uwf.schemas.errorOutput,
        errorPayload,
      );
      const failedStepHash = await writeBrokerStepNode({
        uwf: args.uwf,
        startHash: args.startHash,
        prevHash: args.prevHash,
        role: args.role,
        outputHash: errorOutputHash,
        detailHash,
        agentName: route.gateway,
        edgePrompt: args.edgePrompt,
        startedAtMs,
        completedAtMs,
        cwd: args.effectiveCwd,
        assembledPromptHash,
        usage: accumulatedUsage,
        previousAttempts: null,
      });
      return {
        stepHash: failedStepHash,
        detailHash,
        role: args.role,
        frontmatter: { $status: "error" },
        body: "",
        startedAtMs,
        completedAtMs,
        usage: accumulatedUsage,
        isError: true,
        errorMessage,
      };
    }

    const stepHash = await writeBrokerStepNode({
      uwf: args.uwf,
      startHash: args.startHash,
      prevHash: args.prevHash,
      role: args.role,
      outputHash: extracted.outputHash,
      detailHash,
      agentName: route.gateway,
      edgePrompt: args.edgePrompt,
      startedAtMs,
      completedAtMs,
      cwd: args.effectiveCwd,
      assembledPromptHash,
      usage: accumulatedUsage,
      previousAttempts: args.previousAttempts,
    });

    return {
      stepHash,
      detailHash,
      role: args.role,
      frontmatter: extracted.frontmatter,
      body: extracted.body,
      startedAtMs,
      completedAtMs,
      usage: accumulatedUsage,
      isError: false,
      errorMessage: null,
    };
  } finally {
    sessionStore.close();
  }
}

function brokerUsage(result: SendResult): Usage | null {
  // Sumeru's `done` event reports per-exchange usage. Normalize into the
  // engine's Usage shape so `mergeUsage` can sum across retries.
  const done = result.done;
  if (done === null || typeof done !== "object") {
    return null;
  }
  const turns = done.turnCount;
  const inputTokens = done.tokens !== null ? done.tokens.in : 0;
  const outputTokens = done.tokens !== null ? done.tokens.out : 0;
  const duration = done.durationMs;
  return { turns, inputTokens, outputTokens, duration };
}
