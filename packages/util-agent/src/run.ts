import type { Hash, VarStore } from "@ocas/core";
import { getSchema, validate } from "@ocas/core";
import type {
  CasRef,
  ErrorOutputPayload,
  StepNodePayload,
  ThreadId,
  Usage,
} from "@united-workforce/protocol";
import { config as loadDotenv } from "dotenv";
import { buildOutputFormatInstruction } from "./build-output-format-instruction.js";
import { buildContextWithMeta } from "./context.js";
import { tryFrontmatterFastPath, trySuspendFastPath } from "./frontmatter.js";
import type { AgentStore } from "./storage.js";
import { getEnvPath, getGlobalCasDir, resolveStorageRoot } from "./storage.js";
import type { AdapterOutput, AgentOptions } from "./types.js";

const MAX_FRONTMATTER_RETRIES = 2;

/** Sum two Usage records.  Null-safe: returns whichever side is non-null. */
export function mergeUsage(a: Usage | null, b: Usage | null): Usage | null {
  if (a === null) return b;
  if (b === null) return a;
  return {
    turns: a.turns + b.turns,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    duration: a.duration + b.duration,
  };
}

/** Variable name prefix tracking failed step hashes per (thread, role). */
const THREAD_FAILED_VAR_PREFIX = "@uwf/thread-failed/";

function failedAttemptsVarName(threadId: ThreadId, role: string): string {
  return `${THREAD_FAILED_VAR_PREFIX}${threadId}/${role}`;
}

/**
 * Read the list of failed StepNode hashes recorded for `(threadId, role)`.
 *
 * The variable value is a CAS ref to a text node holding a JSON array of
 * hashes — the var store only accepts CAS refs as values, never raw JSON.
 * Returns null when no failed attempts are recorded (fresh role or after a
 * successful step cleared the list).
 */
export function readFailedAttempts(
  store: AgentStore["store"],
  threadId: ThreadId,
  role: string,
): CasRef[] | null {
  const name = failedAttemptsVarName(threadId, role);
  const vars = store.var.list({ exactName: name });
  const v = vars[0];
  if (v === undefined || v.value === "") {
    return null;
  }
  const node = store.cas.get(v.value as CasRef);
  if (node === null || typeof node.payload !== "string") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(node.payload);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  const refs: CasRef[] = [];
  for (const entry of parsed) {
    if (typeof entry === "string" && entry !== "") {
      refs.push(entry as CasRef);
    }
  }
  return refs.length > 0 ? refs : null;
}

/**
 * Append a failed step hash to the per-(thread, role) failed-attempts variable.
 * The accumulated list is stored as a CAS text node and the variable points at
 * its ref, keeping the variable value a valid CAS hash.
 */
export async function appendFailedAttempt(
  store: AgentStore["store"],
  textSchema: Hash,
  threadId: ThreadId,
  role: string,
  failedStepHash: CasRef,
): Promise<CasRef[]> {
  const existing = readFailedAttempts(store, threadId, role) ?? [];
  const updated: CasRef[] = [...existing, failedStepHash];
  const listHash = await store.cas.put(textSchema, JSON.stringify(updated));
  store.var.set(failedAttemptsVarName(threadId, role), listHash);
  return updated;
}

/** Clear the failed-attempts variable for `(threadId, role)`. */
export function clearFailedAttempts(varStore: VarStore, threadId: ThreadId, role: string): void {
  varStore.remove(failedAttemptsVarName(threadId, role));
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function agentLabel(name: string): string {
  if (name.startsWith("uwf-")) {
    return name;
  }
  return `uwf-${name}`;
}

const USAGE = "usage: <agent-cli> --thread <id> --role <role> --prompt <text>";

function getNamedArg(argv: string[], name: string): string {
  const idx = argv.indexOf(name);
  if (idx === -1 || idx + 1 >= argv.length) {
    return "";
  }
  return argv[idx + 1];
}

export function parseArgv(argv: string[]): { threadId: ThreadId; role: string; prompt: string } {
  const threadId = getNamedArg(argv, "--thread");
  const role = getNamedArg(argv, "--role");
  const prompt = getNamedArg(argv, "--prompt");
  if (threadId === "") fail(USAGE);
  if (role === "") fail(USAGE);
  if (prompt === "")
    fail(
      `--prompt is empty. If this agent was spawned by uwf, the edge prompt template may have unresolved variables. ${USAGE}`,
    );
  return { threadId: threadId as ThreadId, role, prompt };
}

function runWithMessage<T>(label: string, fn: () => Promise<T>): Promise<T> {
  return fn().catch((e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    fail(`${label}: ${message}`);
  });
}

async function writeStepNode(options: {
  store: AgentStore["store"];
  schemas: AgentStore["schemas"];
  startHash: CasRef;
  prevHash: CasRef | null;
  role: string;
  outputHash: CasRef;
  detailHash: CasRef;
  agentName: string;
  edgePrompt: string;
  startedAtMs: number;
  completedAtMs: number;
  assembledPromptHash: CasRef | null;
  usage: Usage | null;
  previousAttempts: CasRef[] | null;
}): Promise<CasRef> {
  const payload: StepNodePayload = {
    start: options.startHash,
    prev: options.prevHash,
    role: options.role,
    output: options.outputHash,
    detail: options.detailHash,
    agent: options.agentName,
    edgePrompt: options.edgePrompt,
    startedAtMs: options.startedAtMs,
    completedAtMs: options.completedAtMs,
    cwd: process.cwd(),
    assembledPrompt: options.assembledPromptHash,
    usage: options.usage,
    previousAttempts: options.previousAttempts,
  };
  const hash = await options.store.cas.put(options.schemas.stepNode, payload);
  const node = options.store.cas.get(hash);
  if (node === null || !validate(options.store, node)) {
    fail("stored StepNode failed schema validation");
  }
  return hash;
}

type ExtractedOutput = {
  outputHash: CasRef;
  frontmatter: Record<string, unknown>;
  body: string;
};

async function tryExtractOutput(
  rawOutput: string,
  outputSchema: CasRef,
  ctx: Awaited<ReturnType<typeof buildContextWithMeta>>,
): Promise<ExtractedOutput | null> {
  // `$status: "$SUSPEND"` is a reserved coroutine yield — store it against the
  // suspend schema, bypassing the role's own frontmatter schema.
  const suspend = await trySuspendFastPath(
    rawOutput,
    ctx.meta.schemas.suspendOutput,
    ctx.meta.store,
  );
  if (suspend !== null) {
    return {
      outputHash: suspend.outputHash,
      frontmatter: suspend.frontmatter,
      body: suspend.body,
    };
  }

  const fastPath = await tryFrontmatterFastPath(rawOutput, outputSchema, ctx.meta.store);
  if (fastPath !== null) {
    return {
      outputHash: fastPath.outputHash,
      frontmatter: fastPath.frontmatter,
      body: fastPath.body,
    };
  }
  return null;
}

async function persistStep(options: {
  ctx: Awaited<ReturnType<typeof buildContextWithMeta>>;
  outputHash: CasRef;
  detailHash: CasRef;
  agentName: string;
  startedAtMs: number;
  completedAtMs: number;
  assembledPromptHash: CasRef | null;
  usage: Usage | null;
  previousAttempts: CasRef[] | null;
}): Promise<CasRef> {
  const { store, schemas, chain, headHash } = options.ctx.meta;
  return writeStepNode({
    store,
    schemas,
    startHash: chain.startHash,
    prevHash: chain.headIsStart ? null : headHash,
    role: options.ctx.role,
    outputHash: options.outputHash,
    detailHash: options.detailHash,
    agentName: options.agentName,
    edgePrompt: options.ctx.edgePrompt,
    startedAtMs: options.startedAtMs,
    completedAtMs: options.completedAtMs,
    assembledPromptHash: options.assembledPromptHash,
    usage: options.usage,
    previousAttempts: options.previousAttempts,
  });
}

/**
 * Resolve uwf storage root + global CAS directory from the process env.
 * This is the agent CLI entry point — the only place in this package allowed
 * to read `process.env` for these settings.
 */
function resolveAgentDirs(): { storageRoot: string; casDir: string } {
  return {
    storageRoot: resolveStorageRoot(process.env.UWF_HOME ?? null),
    casDir: getGlobalCasDir(process.env.OCAS_HOME ?? null),
  };
}

export function createAgent(options: AgentOptions): () => Promise<void> {
  return async function main(): Promise<void> {
    const { threadId, role, prompt } = parseArgv(process.argv);
    const { storageRoot, casDir } = resolveAgentDirs();
    loadDotenv({ path: getEnvPath(storageRoot) });

    const ctx = await runWithMessage("context", () =>
      buildContextWithMeta(threadId, role, prompt, storageRoot, casDir),
    );

    const roleDef = ctx.workflow.roles[role];
    if (roleDef === undefined) {
      fail(`unknown role: ${role}`);
    }

    const frontmatterSchema = getSchema(ctx.meta.store, roleDef.frontmatter);
    if (frontmatterSchema !== null) {
      ctx.outputFormatInstruction = buildOutputFormatInstruction(frontmatterSchema);
    }

    const startedAtMs = Date.now();
    let agentResult = await runWithMessage("agent run failed", () => options.run(ctx));
    agentResult.output = agentResult.output.trimStart();

    // Preserve the primary detail from the first run — it contains the full
    // tool-call turn history.  Continuation retries only fix frontmatter
    // formatting and their 1-turn detail is not meaningful.
    const primaryDetailHash = agentResult.detailHash;

    // Accumulate usage across the primary run and any frontmatter retries so
    // the final StepRecord reflects total resource consumption.
    let accumulatedUsage: Usage | null = agentResult.usage;

    // Try to extract frontmatter; retry via continue if it fails
    let extracted = await tryExtractOutput(agentResult.output, roleDef.frontmatter, ctx);

    for (let retry = 0; retry < MAX_FRONTMATTER_RETRIES && extracted === null; retry++) {
      const correctionMessage =
        "Your previous response did not contain valid YAML frontmatter matching the role schema.\n" +
        "You MUST begin your response with a YAML frontmatter block (--- delimited).\n" +
        "Please output ONLY the corrected frontmatter block followed by your work.";

      agentResult = await runWithMessage("agent continue failed", () =>
        options.continue(agentResult.sessionId, correctionMessage, ctx.meta.store),
      );
      agentResult.output = agentResult.output.trimStart();
      accumulatedUsage = mergeUsage(accumulatedUsage, agentResult.usage);
      extracted = await tryExtractOutput(agentResult.output, roleDef.frontmatter, ctx);
    }

    if (extracted === null) {
      const errorMessage =
        "Agent output does not contain valid YAML frontmatter matching the role schema " +
        `after ${MAX_FRONTMATTER_RETRIES} retries.\n` +
        `Raw output (first 500 chars): ${agentResult.output.slice(0, 500)}`;
      const completedAtMs = Date.now();
      // Persist a failed StepNode so the turns + usage from the agent run are
      // preserved in CAS and can be linked to a future successful retry via
      // `previousAttempts`. Thread head MUST NOT be advanced — the engine
      // (cmdThreadStepOnce) decides routing based on `isError: true`.
      const errorPayload: ErrorOutputPayload = {
        $status: "error",
        error: errorMessage,
        phase: "frontmatter_extraction",
      };
      const errorOutputHash = await ctx.meta.store.cas.put(
        ctx.meta.schemas.errorOutput,
        errorPayload,
      );

      const failedStepHash = await persistStep({
        ctx,
        outputHash: errorOutputHash,
        detailHash: primaryDetailHash,
        agentName: agentLabel(options.name),
        startedAtMs,
        completedAtMs,
        assembledPromptHash: null,
        usage: accumulatedUsage,
        previousAttempts: null,
      });

      // Track the failed hash so a future successful retry of the same
      // (thread, role) can record `previousAttempts: [failedStepHash, ...]`.
      await appendFailedAttempt(
        ctx.meta.store,
        ctx.meta.schemas.text,
        threadId,
        role,
        failedStepHash,
      );

      const failedOutput: AdapterOutput = {
        stepHash: failedStepHash,
        detailHash: primaryDetailHash,
        role,
        frontmatter: { $status: "error" },
        body: "",
        startedAtMs,
        completedAtMs,
        usage: accumulatedUsage,
        isError: true,
        errorMessage,
      };
      process.stdout.write(`${JSON.stringify(failedOutput)}\n`);
      return;
    }
    const completedAtMs = Date.now();
    const usage = accumulatedUsage;

    // Store the assembled prompt in CAS for later inspection via `step read --prompt`
    const promptText = agentResult.assembledPrompt;
    let assembledPromptHash: CasRef | null = null;
    if (promptText !== "") {
      try {
        assembledPromptHash = await ctx.meta.store.cas.put(ctx.meta.schemas.text, promptText);
      } catch {
        assembledPromptHash = null;
      }
    }

    const previousAttempts = readFailedAttempts(ctx.meta.store, threadId, role);

    const stepHash = await persistStep({
      ctx,
      outputHash: extracted.outputHash,
      detailHash: primaryDetailHash,
      agentName: agentLabel(options.name),
      startedAtMs,
      completedAtMs,
      assembledPromptHash,
      usage,
      previousAttempts,
    });

    if (previousAttempts !== null) {
      clearFailedAttempts(ctx.meta.store.var, threadId, role);
    }

    const adapterOutput: AdapterOutput = {
      stepHash,
      detailHash: primaryDetailHash,
      role,
      frontmatter: extracted.frontmatter,
      body: extracted.body,
      startedAtMs,
      completedAtMs,
      usage,
      isError: false,
      errorMessage: null,
    };
    process.stdout.write(`${JSON.stringify(adapterOutput)}\n`);
  };
}
