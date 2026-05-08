import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import {
  type CasStore,
  getContentMerklePayload,
  putStepMerkleNode,
  putThreadMerkleNode,
} from "../cas/index.js";
import { resolveModel } from "../config/index.js";
import { createExtract } from "../extract/index.js";
import { readWorkflowRegistry, type WorkflowConfig } from "../registry/index.js";
import type {
  LlmProvider,
  ThreadInput,
  WorkflowCompletion,
  WorkflowFn,
  WorkflowFnOptions,
  WorkflowResult,
} from "../types.js";
import { err, type LogFn, normalizeRefsField, ok, type Result } from "../util/index.js";

import { runSupervisor } from "./supervisor.js";
import type { ExecuteThreadIo, ExecuteThreadOptions } from "./types.js";

async function resolveEngineRegistryRuntime(storageRoot: string): Promise<
  Result<
    {
      extract: ReturnType<typeof createExtract>;
      llmProvider: LlmProvider;
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
  return ok({ extract: createExtract(llmProvider), llmProvider, workflowConfig: cfg });
}

async function appendDataLine(path: string, record: unknown): Promise<void> {
  const line = `${JSON.stringify(record)}\n`;
  await appendFile(path, line, "utf8");
}

async function finalizeThreadResult(params: {
  cas: CasStore;
  workflowName: string;
  threadId: string;
  stepMerkleHashes: readonly string[];
  completion: WorkflowCompletion;
}): Promise<WorkflowResult> {
  const rootHash = await putThreadMerkleNode(
    params.cas,
    {
      workflow: params.workflowName,
      threadId: params.threadId,
      result: {
        returnCode: params.completion.returnCode,
        summary: params.completion.summary,
      },
    },
    params.stepMerkleHashes,
  );
  return {
    returnCode: params.completion.returnCode,
    summary: params.completion.summary,
    rootHash,
  };
}

async function finalizeAbortedThread(params: {
  cas: CasStore;
  workflowName: string;
  threadId: string;
  stepMerkleHashes: string[];
  logger: LogFn;
  abortLogTag: string;
}): Promise<WorkflowResult> {
  params.logger(params.abortLogTag, `thread ${params.threadId} aborted`);
  return finalizeThreadResult({
    cas: params.cas,
    workflowName: params.workflowName,
    threadId: params.threadId,
    stepMerkleHashes: params.stepMerkleHashes,
    completion: { returnCode: 130, summary: "thread aborted" },
  });
}

async function maybeSupervisorHaltsThread(params: {
  workflowConfig: WorkflowConfig;
  input: ThreadInput;
  written: number;
  recentSupervisorSteps: readonly { role: string; summary: string }[];
  logger: LogFn;
  threadId: string;
  cas: CasStore;
  workflowName: string;
  stepMerkleHashes: string[];
}): Promise<WorkflowResult | null> {
  const interval = params.workflowConfig.supervisorInterval;
  if (interval <= 0 || params.written % interval !== 0) {
    return null;
  }
  const sup = await runSupervisor({
    config: params.workflowConfig,
    prompt: params.input.prompt,
    recentSteps: params.recentSupervisorSteps,
    logger: params.logger,
  });
  if (!sup.ok) {
    params.logger("K6PW9NYT", `supervisor skipped: ${sup.error}`);
    return null;
  }
  if (sup.value !== "stop") {
    return null;
  }
  params.logger("M4QX8VHN", `thread ${params.threadId} stopped by supervisor`);
  return finalizeThreadResult({
    cas: params.cas,
    workflowName: params.workflowName,
    threadId: params.threadId,
    stepMerkleHashes: params.stepMerkleHashes,
    completion: { returnCode: 0, summary: "completed: supervisor stopped thread" },
  });
}

async function driveWorkflowGenerator(params: {
  fn: WorkflowFn;
  workflowName: string;
  workflowConfig: WorkflowConfig;
  input: ThreadInput;
  bundleOptions: WorkflowFnOptions;
  executeOptions: ExecuteThreadOptions;
  dataJsonlPath: string;
  threadId: string;
  logger: LogFn;
  cas: CasStore;
  stepMerkleHashes: string[];
}): Promise<WorkflowResult> {
  const {
    fn,
    workflowName,
    workflowConfig,
    input,
    bundleOptions,
    executeOptions,
    dataJsonlPath,
    threadId,
    logger,
    cas,
    stepMerkleHashes,
  } = params;
  const gen = fn(input, bundleOptions);
  let written = 0;
  const recentSupervisorSteps: { role: string; summary: string }[] = input.steps.map((s) => ({
    role: s.role,
    summary: JSON.stringify(s.meta),
  }));

  while (true) {
    if (executeOptions.signal.aborted) {
      return await finalizeAbortedThread({
        cas,
        workflowName,
        threadId,
        stepMerkleHashes,
        logger,
        abortLogTag: "V8JX4NP2",
      });
    }

    if (written >= executeOptions.maxRounds) {
      logger("R3CW7YBQ", `thread ${threadId} stopped at maxRounds=${executeOptions.maxRounds}`);
      return await finalizeThreadResult({
        cas,
        workflowName,
        threadId,
        stepMerkleHashes,
        completion: {
          returnCode: 0,
          summary: `completed: reached maxRounds (${executeOptions.maxRounds})`,
        },
      });
    }

    const iterResult = await gen.next();

    if (iterResult.done) {
      logger("F3HN8QKP", `thread ${threadId} generator finished`);
      const completion = iterResult.value;
      return await finalizeThreadResult({
        cas,
        workflowName,
        threadId,
        stepMerkleHashes,
        completion,
      });
    }

    written++;
    const step = iterResult.value;
    const resolved = await getContentMerklePayload(cas, step.contentHash);
    if (resolved === null) {
      throw new Error(
        `role step ${step.role}: CAS blob missing for contentHash ${step.contentHash}`,
      );
    }
    const ts = Date.now();
    await appendDataLine(dataJsonlPath, {
      role: step.role,
      contentHash: step.contentHash,
      meta: step.meta,
      refs: normalizeRefsField(step.refs),
      timestamp: ts,
    });

    const stepNodeHash = await putStepMerkleNode(
      cas,
      { role: step.role, meta: step.meta },
      step.contentHash,
    );
    stepMerkleHashes.push(stepNodeHash);

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
        workflowName,
        threadId,
        stepMerkleHashes,
        logger,
        abortLogTag: "V8JX4NP4",
      });
    }

    const supervised = await maybeSupervisorHaltsThread({
      workflowConfig,
      input,
      written,
      recentSupervisorSteps,
      logger,
      threadId,
      cas,
      workflowName,
      stepMerkleHashes,
    });
    if (supervised !== null) {
      return supervised;
    }
  }
}

/**
 * Execute a workflow thread: drive the bundle's AsyncGenerator, RFC-001 `.data.jsonl` records,
 * debug lines via `logger` to `.info.jsonl`.
 */
export async function executeThread(
  fn: WorkflowFn,
  workflowName: string,
  input: ThreadInput,
  options: ExecuteThreadOptions,
  io: ExecuteThreadIo,
  logger: LogFn,
): Promise<WorkflowResult> {
  await mkdir(dirname(io.dataJsonlPath), { recursive: true });
  await mkdir(dirname(io.infoJsonlPath), { recursive: true });

  const prefilled = options.prefilledDiskSteps;
  if (prefilled !== null && prefilled.length !== input.steps.length) {
    throw new Error(
      `prefilledDiskSteps length (${prefilled.length}) must match input.steps length (${input.steps.length})`,
    );
  }

  const nowMs = Date.now();
  const startRecord: Record<string, unknown> = {
    name: workflowName,
    hash: io.hash,
    threadId: io.threadId,
    parameters: {
      prompt: input.prompt,
      options: {
        maxRounds: options.maxRounds,
        depth: options.depth,
      },
    },
    timestamp: nowMs,
  };
  if (options.forkSourceThreadId !== null) {
    startRecord.forkFrom = { threadId: options.forkSourceThreadId };
  }

  await appendDataLine(io.dataJsonlPath, startRecord);

  logger("T9HQ2KHM", `thread ${io.threadId} started for workflow ${workflowName}`);

  const stepMerkleHashes: string[] = [];

  if (prefilled !== null) {
    for (const row of prefilled) {
      const prefilledPayload = await getContentMerklePayload(io.cas, row.contentHash);
      if (prefilledPayload === null) {
        throw new Error(
          `prefilled step ${row.role}: CAS blob missing for contentHash ${row.contentHash}`,
        );
      }
      await appendDataLine(io.dataJsonlPath, {
        role: row.role,
        contentHash: row.contentHash,
        meta: row.meta,
        refs: normalizeRefsField(row.refs),
        timestamp: row.timestamp,
      });
      const stepNodeHash = await putStepMerkleNode(
        io.cas,
        { role: row.role, meta: row.meta },
        row.contentHash,
      );
      stepMerkleHashes.push(stepNodeHash);
    }
  }

  if (options.maxRounds <= 0) {
    logger("R3CW7YBQ", `thread ${io.threadId} stopped at maxRounds=${options.maxRounds}`);
    return await finalizeThreadResult({
      cas: io.cas,
      workflowName,
      threadId: io.threadId,
      stepMerkleHashes,
      completion: {
        returnCode: 0,
        summary: `completed: reached maxRounds (${options.maxRounds})`,
      },
    });
  }

  const registryRuntime = await resolveEngineRegistryRuntime(options.storageRoot);
  if (!registryRuntime.ok) {
    throw new Error(registryRuntime.error);
  }

  const bundleOptions: WorkflowFnOptions = {
    threadId: io.threadId,
    maxRounds: options.maxRounds,
    depth: options.depth,
    cas: io.cas,
    extract: registryRuntime.value.extract,
    llmProvider: registryRuntime.value.llmProvider,
  };

  return await driveWorkflowGenerator({
    fn,
    workflowName,
    workflowConfig: registryRuntime.value.workflowConfig,
    input,
    bundleOptions,
    executeOptions: options,
    dataJsonlPath: io.dataJsonlPath,
    threadId: io.threadId,
    logger,
    cas: io.cas,
    stepMerkleHashes,
  });
}
