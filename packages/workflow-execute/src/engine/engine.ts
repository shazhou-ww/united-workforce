import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  type CasStore,
  getContentMerklePayload,
  putContentNodeWithRefs,
  putStartNode,
  putStateNode,
} from "@uncaged/workflow-cas";
import type { StateNode } from "@uncaged/workflow-protocol";
import {
  readWorkflowRegistry,
  resolveModel,
  type WorkflowConfig,
} from "@uncaged/workflow-register";
import type {
  LlmProvider,
  RoleOutput,
  ThreadContext,
  WorkflowCompletion,
  WorkflowFn,
  WorkflowResult,
  WorkflowRuntime,
} from "@uncaged/workflow-runtime";
import { END, START } from "@uncaged/workflow-runtime";
import { err, type LogFn, ok, type Result } from "@uncaged/workflow-util";

import { createExtract } from "../extract/index.js";
import { runSupervisor } from "./supervisor.js";
import {
  appendThreadHistoryEntry,
  getBundleDir,
  removeThreadEntry,
  upsertThreadEntry,
} from "./threads-index.js";
import type { ChainState, ExecuteThreadIo, ExecuteThreadOptions } from "./types.js";
import { EMPTY_CHAIN_STATE } from "./types.js";

/** Cap for {@link StateNode}.payload.ancestors: 1 parent + 10 skip-list. */
const ANCESTORS_CAP = 11;

function computeAncestors(chain: ChainState): string[] {
  if (chain.parentStateHash === null) {
    return [];
  }
  return [chain.parentStateHash, ...chain.parentAncestors].slice(0, ANCESTORS_CAP);
}

async function resolveEngineRegistryRuntime(
  storageRoot: string,
  cas: CasStore,
): Promise<
  Result<
    {
      extract: ReturnType<typeof createExtract>;
      workflowConfig: WorkflowConfig;
    },
    string
  >
> {
  const reg = await readWorkflowRegistry(storageRoot);
  if (!reg.ok) {
    return err(reg.error.message);
  }
  const cfg = reg.value.config;
  if (cfg === null) {
    return err("workflow registry has no global config section");
  }
  const resolved = resolveModel(cfg, "extract");
  if (!resolved.ok) {
    return resolved;
  }
  const ex = resolved.value;
  const llmProvider: LlmProvider = {
    baseUrl: ex.baseUrl,
    apiKey: ex.apiKey,
    model: ex.model,
  };
  return ok({ extract: createExtract(llmProvider, { cas }), workflowConfig: cfg });
}

async function appendStateForStep(params: {
  cas: CasStore;
  startHash: string;
  chain: ChainState;
  role: string;
  contentHash: string;
  meta: Record<string, unknown>;
  refs: readonly string[];
  timestamp: number;
}): Promise<{ stateHash: string; chain: ChainState }> {
  const text = await getContentMerklePayload(params.cas, params.contentHash);
  if (text === null) {
    throw new Error(
      `role step ${params.role}: CAS blob missing for contentHash ${params.contentHash}`,
    );
  }
  const artifactRefs = params.refs.filter((r) => r !== params.contentHash);
  const contentHash = await putContentNodeWithRefs(params.cas, text, artifactRefs);
  const ancestors = computeAncestors(params.chain);
  const payload: StateNode["payload"] = {
    role: params.role,
    meta: params.meta,
    start: params.startHash,
    content: contentHash,
    ancestors,
    compact: null,
    timestamp: params.timestamp,
  };
  const stateHash = await putStateNode(params.cas, payload);
  return {
    stateHash,
    chain: { parentStateHash: stateHash, parentAncestors: ancestors },
  };
}

async function appendEndState(params: {
  cas: CasStore;
  startHash: string;
  chain: ChainState;
  completion: WorkflowCompletion;
  timestamp: number;
}): Promise<string> {
  const contentHash = await putContentNodeWithRefs(params.cas, params.completion.summary, []);
  const ancestors = computeAncestors(params.chain);
  const payload: StateNode["payload"] = {
    role: END,
    meta: { returnCode: params.completion.returnCode, summary: params.completion.summary },
    start: params.startHash,
    content: contentHash,
    ancestors,
    compact: null,
    timestamp: params.timestamp,
  };
  return putStateNode(params.cas, payload);
}

async function finalizeThread(params: {
  cas: CasStore;
  bundleDir: string;
  threadId: string;
  startHash: string;
  chain: ChainState;
  completion: WorkflowCompletion;
}): Promise<WorkflowResult> {
  const ts = Date.now();
  const endHash = await appendEndState({
    cas: params.cas,
    startHash: params.startHash,
    chain: params.chain,
    completion: params.completion,
    timestamp: ts,
  });
  await removeThreadEntry(params.bundleDir, params.threadId);
  await appendThreadHistoryEntry(params.bundleDir, {
    threadId: params.threadId,
    head: endHash,
    start: params.startHash,
    completedAt: ts,
  });
  return {
    returnCode: params.completion.returnCode,
    summary: params.completion.summary,
    rootHash: endHash,
  };
}

async function finalizeAbortedThread(params: {
  cas: CasStore;
  bundleDir: string;
  threadId: string;
  startHash: string;
  chain: ChainState;
  logger: LogFn;
  abortLogTag: string;
}): Promise<WorkflowResult> {
  params.logger(params.abortLogTag, `thread ${params.threadId} aborted`);
  return finalizeThread({
    cas: params.cas,
    bundleDir: params.bundleDir,
    threadId: params.threadId,
    startHash: params.startHash,
    chain: params.chain,
    completion: { returnCode: 130, summary: "thread aborted" },
  });
}

async function maybeSupervisorHaltsThread(params: {
  workflowConfig: WorkflowConfig;
  thread: ThreadContext;
  written: number;
  recentSupervisorSteps: readonly { role: string; summary: string }[];
  logger: LogFn;
  threadId: string;
  cas: CasStore;
  bundleDir: string;
  startHash: string;
  chain: ChainState;
}): Promise<WorkflowResult | null> {
  const interval = params.workflowConfig.supervisorInterval;
  if (interval <= 0 || params.written % interval !== 0) {
    return null;
  }
  const sup = await runSupervisor({
    config: params.workflowConfig,
    prompt: params.thread.start.content,
    recentSteps: params.recentSupervisorSteps,
    logger: params.logger,
  });
  if (!sup.ok) {
    params.logger("K6PW9NYT", `supervisor skipped: ${sup.error}`);
    return null;
  }
  if (sup.value !== "kill") {
    return null;
  }
  params.logger("M4QX8VHN", `thread ${params.threadId} killed by supervisor`);
  return finalizeThread({
    cas: params.cas,
    bundleDir: params.bundleDir,
    threadId: params.threadId,
    startHash: params.startHash,
    chain: params.chain,
    completion: { returnCode: 1, summary: "killed: supervisor detected pathological behavior" },
  });
}

async function publishHead(params: {
  bundleDir: string;
  threadId: string;
  startHash: string;
  headHash: string;
}): Promise<void> {
  await upsertThreadEntry(params.bundleDir, params.threadId, {
    head: params.headHash,
    start: params.startHash,
    updatedAt: Date.now(),
  });
}

async function driveWorkflowGenerator(params: {
  fn: WorkflowFn;
  workflowConfig: WorkflowConfig;
  thread: ThreadContext;
  runtime: WorkflowRuntime;
  executeOptions: ExecuteThreadOptions;
  threadId: string;
  logger: LogFn;
  cas: CasStore;
  bundleDir: string;
  startHash: string;
  chain: ChainState;
}): Promise<WorkflowResult> {
  const {
    fn,
    workflowConfig,
    thread,
    runtime,
    executeOptions,
    threadId,
    logger,
    cas,
    bundleDir,
    startHash,
  } = params;
  let chain: ChainState = params.chain;
  const gen = fn(thread, runtime);
  let written = 0;
  const recentSupervisorSteps: { role: string; summary: string }[] = thread.steps.map((s) => ({
    role: s.role,
    summary: JSON.stringify(s.meta),
  }));

  while (true) {
    if (executeOptions.signal.aborted) {
      return await finalizeAbortedThread({
        cas,
        bundleDir,
        threadId,
        startHash,
        chain,
        logger,
        abortLogTag: "V8JX4NP2",
      });
    }

    if (written >= executeOptions.maxRounds) {
      logger("R3CW7YBQ", `thread ${threadId} stopped at maxRounds=${executeOptions.maxRounds}`);
      return await finalizeThread({
        cas,
        bundleDir,
        threadId,
        startHash,
        chain,
        completion: {
          returnCode: 0,
          summary: `completed: reached maxRounds (${executeOptions.maxRounds})`,
        },
      });
    }

    const iterResult = await gen.next();

    if (iterResult.done) {
      logger("F3HN8QKP", `thread ${threadId} generator finished`);
      return await finalizeThread({
        cas,
        bundleDir,
        threadId,
        startHash,
        chain,
        completion: iterResult.value,
      });
    }

    written++;
    const step = iterResult.value;
    const ts = Date.now();
    const written_ = await appendStateForStep({
      cas,
      startHash,
      chain,
      role: step.role,
      contentHash: step.contentHash,
      meta: step.meta,
      refs: step.refs,
      timestamp: ts,
    });
    chain = written_.chain;
    await publishHead({ bundleDir, threadId, startHash, headHash: written_.stateHash });

    logger("N7BW4YHQ", `thread ${threadId} wrote role ${step.role}`);

    recentSupervisorSteps.push({
      role: step.role,
      summary: JSON.stringify(step.meta),
    });

    await Promise.race([
      executeOptions.awaitAfterEachYield(),
      new Promise<void>((resolve) => {
        if (executeOptions.signal.aborted) {
          resolve();
          return;
        }
        executeOptions.signal.addEventListener("abort", () => resolve(), { once: true });
      }),
    ]);

    if (executeOptions.signal.aborted) {
      return await finalizeAbortedThread({
        cas,
        bundleDir,
        threadId,
        startHash,
        chain,
        logger,
        abortLogTag: "V8JX4NP4",
      });
    }

    const supervised = await maybeSupervisorHaltsThread({
      workflowConfig,
      thread,
      written,
      recentSupervisorSteps,
      logger,
      threadId,
      cas,
      bundleDir,
      startHash,
      chain,
    });
    if (supervised !== null) {
      return supervised;
    }
  }
}

/**
 * Execute a workflow thread by driving the bundle's `AsyncGenerator`.
 *
 * Persistence layout (RFC v3 — CAS-based thread storage):
 * - Thread chain is written as immutable CAS blobs: a single {@link StartNode}
 *   plus one {@link StateNode} per role step (including a final `__end__`
 *   state on completion / abort / `maxRounds`).
 * - The active thread head is published in `<bundleDir>/threads.json`; on
 *   completion it is removed and a record is appended to
 *   `<bundleDir>/history/{YYYY-MM-DD}.jsonl`.
 * - Debug logging continues to flow through `logger` to `.info.jsonl`.
 */
export async function executeThread(
  fn: WorkflowFn,
  workflowName: string,
  input: { prompt: string; steps: RoleOutput[] },
  options: ExecuteThreadOptions,
  io: ExecuteThreadIo,
  logger: LogFn,
): Promise<WorkflowResult> {
  await mkdir(dirname(io.infoJsonlPath), { recursive: true });

  const prefilled = options.prefilledDiskSteps;
  const fork = options.forkContinuation;

  if (fork !== null && prefilled !== null) {
    throw new Error("forkContinuation and prefilledDiskSteps cannot both be set");
  }

  if (prefilled !== null && prefilled.length !== input.steps.length) {
    throw new Error(
      `prefilledDiskSteps length (${prefilled.length}) must match input.steps length (${input.steps.length})`,
    );
  }

  const replayTs = options.replayTimestamps;
  if (replayTs !== null && replayTs.length !== input.steps.length) {
    throw new Error(
      `replayTimestamps length (${replayTs.length}) must match input.steps length (${input.steps.length})`,
    );
  }

  const bundleDir = getBundleDir(options.storageRoot, io.hash);

  let startHash: string;

  if (fork !== null) {
    startHash = fork.startHash;
    logger("T9HQ2KHM", `thread ${io.threadId} continued fork for workflow ${workflowName}`);
  } else {
    const promptHash = await io.cas.put(input.prompt);
    startHash = await putStartNode(
      io.cas,
      {
        name: workflowName,
        hash: io.hash,
        maxRounds: options.maxRounds,
        depth: options.depth,
      },
      promptHash,
    );

    await publishHead({
      bundleDir,
      threadId: io.threadId,
      startHash,
      headHash: startHash,
    });

    logger("T9HQ2KHM", `thread ${io.threadId} started for workflow ${workflowName}`);
  }

  let chain: ChainState = fork !== null ? fork.initialChain : EMPTY_CHAIN_STATE;

  if (prefilled !== null) {
    for (const row of prefilled) {
      const written = await appendStateForStep({
        cas: io.cas,
        startHash,
        chain,
        role: row.role,
        contentHash: row.contentHash,
        meta: row.meta,
        refs: row.refs,
        timestamp: row.timestamp,
      });
      chain = written.chain;
      await publishHead({
        bundleDir,
        threadId: io.threadId,
        startHash,
        headHash: written.stateHash,
      });
    }
  }

  const nowMs = Date.now();

  if (options.maxRounds <= 0) {
    logger("R3CW7YBQ", `thread ${io.threadId} stopped at maxRounds=${options.maxRounds}`);
    return await finalizeThread({
      cas: io.cas,
      bundleDir,
      threadId: io.threadId,
      startHash,
      chain,
      completion: {
        returnCode: 0,
        summary: `completed: reached maxRounds (${options.maxRounds})`,
      },
    });
  }

  const registryRuntime = await resolveEngineRegistryRuntime(options.storageRoot, io.cas);
  if (!registryRuntime.ok) {
    throw new Error(registryRuntime.error);
  }

  const thread: ThreadContext = {
    threadId: io.threadId,
    depth: options.depth,
    start: {
      role: START,
      content: input.prompt,
      meta: { maxRounds: options.maxRounds },
      timestamp: nowMs,
    },
    steps: input.steps.map((out, i) => ({
      role: out.role,
      contentHash: out.contentHash,
      meta: out.meta,
      refs: out.refs,
      timestamp: replayTs?.[i] ?? prefilled?.[i]?.timestamp ?? nowMs + i,
    })),
  };

  const runtime: WorkflowRuntime = {
    cas: io.cas,
    extract: registryRuntime.value.extract,
  };

  return await driveWorkflowGenerator({
    fn,
    workflowConfig: registryRuntime.value.workflowConfig,
    thread,
    runtime,
    executeOptions: options,
    threadId: io.threadId,
    logger,
    cas: io.cas,
    bundleDir,
    startHash,
    chain,
  });
}
