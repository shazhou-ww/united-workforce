/**
 * Broker-driven step execution. Replaces the legacy `spawnAgent` /
 * `executeAgentCommand` / last-stdout-line JSON parsing path with
 * `broker.send()` over the Sumeru HTTP API.
 *
 * Phase 3 (#380) — `cmdThreadStepOnce`, `cmdThreadResume`, and `cmdThreadPoke`
 * use this module instead of spawning per-role CLI binaries.
 */

import { putSchema, validate } from "@ocas/core";
import {
  type AgentRoute,
  createBroker,
  createSessionStore,
  type SendResult,
  type SessionStore,
} from "@united-workforce/broker";
import type {
  AgentAlias,
  AgentConfig,
  CasRef,
  StepNodePayload,
  ThreadId,
  Usage,
  WorkflowConfig,
  WorkflowPayload,
} from "@united-workforce/protocol";
import { createLogger, type ProcessLogger } from "@united-workforce/util";
import {
  buildFrontmatterRetryPrompt,
  buildOutputFormatInstruction,
  mergeUsage,
  tryFrontmatterFastPath,
  trySuspendFastPath,
} from "@united-workforce/util-agent";
import { join } from "node:path";
import type { UwfStore } from "../store.js";
import { fail } from "./shared.js";

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

type BuildOutputSchema = (workflow: WorkflowPayload, role: string) => Record<string, unknown> | null;

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

/** Persist the raw broker.send output as a CAS detail node — single assistant turn. */
async function storeBrokerDetail(
  uwf: UwfStore,
  result: SendResult,
  startedAtMs: number,
  completedAtMs: number,
): Promise<CasRef> {
  const turnSchemaHash = await putSchema(uwf.store, TURN_SCHEMA);
  const detailSchemaHash = await putSchema(uwf.store, DETAIL_SCHEMA);

  const turn = { role: "assistant", content: result.output };
  const turnHash = await uwf.store.cas.put(turnSchemaHash, turn);

  const detail = {
    sessionId: result.sessionId,
    duration: Math.max(0, completedAtMs - startedAtMs),
    turnCount: 1,
    turns: [turnHash],
  };
  return uwf.store.cas.put(detailSchemaHash, detail);
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
    assembledPrompt: null,
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

    const startedAtMs = Date.now();
    const primary = await broker.send({
      threadId: args.threadId,
      role: args.role,
      prompt: args.edgePrompt,
    });

    const outputSchemaHash = loadRoleSchemaHash(args.workflow, args.role);
    let extracted = await tryExtract(args.uwf, primary.output, outputSchemaHash);
    let accumulatedUsage: Usage | null = brokerUsage(primary);
    let lastOutput = primary.output;
    let lastSessionId = primary.sessionId;

    // Retry on the same (threadId, role) — the broker re-uses the cached
    // Sumeru session, so the agent gets to "fix its frontmatter" with full
    // context preserved.
    for (
      let retry = 0;
      retry < MAX_FRONTMATTER_RETRIES && extracted === null;
      retry++
    ) {
      const roleSchema = args.uwf.store.cas.get(outputSchemaHash);
      const instruction =
        roleSchema !== null
          ? buildOutputFormatInstruction(roleSchema.payload as Record<string, unknown>)
          : "";
      const correctionPrompt = buildFrontmatterRetryPrompt(instruction);
      log(
        PL_FRONTMATTER_RETRY,
        `frontmatter retry ${retry + 1}/${MAX_FRONTMATTER_RETRIES} thread=${args.threadId} role=${args.role}`,
      );
      const retryResult = await broker.send({
        threadId: args.threadId,
        role: args.role,
        prompt: correctionPrompt,
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
  const record = done as Record<string, unknown>;
  const turns = typeof record.turns === "number" ? record.turns : result.assistantTurnCount;
  const inputTokens = typeof record.inputTokens === "number" ? record.inputTokens : 0;
  const outputTokens = typeof record.outputTokens === "number" ? record.outputTokens : 0;
  const duration = typeof record.duration === "number" ? record.duration : 0;
  return { turns, inputTokens, outputTokens, duration };
}
