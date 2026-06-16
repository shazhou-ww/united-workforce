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
import { appendActiveTurn, clearActiveTurns, readActiveTurns, type UwfStore } from "../store.js";
import { expandOutput, fail } from "./shared.js";

const log = createLogger({ sink: { kind: "stderr" } });

/** Tag for broker.send call site. */
const PL_BROKER_SEND = "BR0KR5ND";
/** Tag for frontmatter retry call sites. */
const PL_FRONTMATTER_RETRY = "F4RTM4RT";
/** Tag for frontmatter extraction failure. */
const PL_FRONTMATTER_FAIL = "F4FA1L7Z";

const MAX_FRONTMATTER_RETRIES = 2;

const TURN_SCHEMA = {
  title: "broker-turn",
  type: "object" as const,
  required: ["role", "content"],
  properties: {
    role: { type: "string" as const, enum: ["assistant", "tool"] },
    content: { type: "string" as const },
  },
  additionalProperties: false,
};

const DETAIL_SCHEMA = {
  title: "broker-detail",
  type: "object" as const,
  required: ["sessionId", "duration", "turnCount", "turns"],
  properties: {
    sessionId: { type: "string" as const },
    duration: { type: "integer" as const },
    turnCount: { type: "integer" as const },
    turns: {
      type: "array" as const,
      items: { type: "string" as const, format: "ocas_ref" },
    },
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
 * Persist the step's detail node by solidifying the in-flight active-turns list
 * (Phase 2, #398). Reads the full ordered turn-hash list accumulated under
 * `@uwf/active-turns/<threadId>/<role>` (appended in real time by the `onTurn`
 * callback), writes them all into the immutable detail node
 * (`detail.turns = <all hashes>`, `detail.turnCount = turns.length`), then
 * deletes the now-frozen active var. A step that produced zero assistant turns
 * persists an empty `turns` list with `turnCount === 0`.
 */
async function storeBrokerDetail(
  uwf: UwfStore,
  result: SendResult,
  threadId: ThreadId,
  role: string,
  startedAtMs: number,
  completedAtMs: number,
): Promise<CasRef> {
  const detailSchemaHash = await putSchema(uwf.store, DETAIL_SCHEMA);

  // Solidify the full ordered turn list captured by the realtime onTurn
  // callback into the immutable detail, then drop the mutable pointer.
  const turns = readActiveTurns(uwf.store, threadId, role);
  clearActiveTurns(uwf.store, threadId, role);

  const detail = {
    sessionId: result.sessionId,
    duration: Math.max(0, completedAtMs - startedAtMs),
    turnCount: turns.length,
    turns,
  };
  return uwf.store.cas.put(detailSchemaHash, detail);
}

/**
 * Build the realtime `onTurn` callback wired into `broker.send` (Phase 2,
 * #398). For each arriving assistant turn it (a) stores the pure
 * `{ role: "assistant", content }` turn node in CAS under `TURN_SCHEMA`, then
 * (b) appends its hash to `@uwf/active-turns/<threadId>/<role>` via a
 * read-modify-write on the array node. All work is synchronous, so the active
 * var reaches its final length before `send()` resolves — this is what makes a
 * step's turns visible to other processes mid-flight. The turn node holds
 * uwf's own CAS hash of `{role, content}`; `BrokerTurn.hash` (Sumeru-computed)
 * is not persisted into the turn node.
 */
function makeOnTurn(uwf: UwfStore, threadId: ThreadId, role: string): (turn: BrokerTurn) => void {
  // Register the turn schema once; putSchema is content-addressed + idempotent.
  const turnSchemaHash = putSchema(uwf.store, TURN_SCHEMA);
  return (turn: BrokerTurn) => {
    const turnHash = uwf.store.cas.put(turnSchemaHash, {
      role: "assistant",
      content: turn.content,
    }) as CasRef;
    appendActiveTurn(uwf.store, threadId, role, turnHash);
  };
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
 * Side effects:
 *   - inserts a row in the broker session store keyed by (threadId, role)
 *   - writes a turn / detail / StepNode triplet to CAS
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

    // Start-of-step clear (Phase 2, #398): a crash-rerun is a fresh attempt, so
    // any residual active var from a failed prior attempt is dropped here —
    // before any onTurn can fire — rather than appended onto. The clear is
    // start-of-step only (NOT per-send): frontmatter retries below re-send on
    // the cached session and must keep appending to the same attempt's var.
    clearActiveTurns(args.uwf.store, args.threadId, args.role);
    const onTurn = makeOnTurn(args.uwf, args.threadId, args.role);

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
    const detailHash = await storeBrokerDetail(
      args.uwf,
      { ...primary, output: lastOutput, sessionId: lastSessionId },
      args.threadId,
      args.role,
      startedAtMs,
      completedAtMs,
    );

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
