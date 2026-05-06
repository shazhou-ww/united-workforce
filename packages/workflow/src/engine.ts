import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { LogFn } from "./logger.js";
import type { ThreadInput, WorkflowFn, WorkflowFnOptions, WorkflowResult } from "./types.js";

export type ExecuteThreadIo = {
  threadId: string;
  hash: string;
  dataJsonlPath: string;
  infoJsonlPath: string;
};

/** One persisted role line in `.data.jsonl` (engine adds these for fork replay before running the generator). */
export type PrefilledDiskStep = {
  role: string;
  content: string;
  meta: Record<string, unknown>;
  timestamp: number;
};

export type ExecuteThreadOptions = {
  maxRounds: number;
  signal: AbortSignal;
  /** Invoked after each successful yield (and outer-loop checks); used for pause/resume. */
  awaitAfterEachYield: () => Promise<void>;
  /** When non-null, written into the start record so tooling can trace lineage. */
  forkSourceThreadId: string | null;
  /**
   * Written to `.data.jsonl` immediately after the start record, before the generator runs.
   * Must match `input.steps` length and order when present.
   */
  prefilledDiskSteps: PrefilledDiskStep[] | null;
};

async function appendDataLine(path: string, record: unknown): Promise<void> {
  const line = `${JSON.stringify(record)}\n`;
  await appendFile(path, line, "utf8");
}

async function driveWorkflowGenerator(params: {
  fn: WorkflowFn;
  input: ThreadInput;
  bundleOptions: WorkflowFnOptions;
  executeOptions: ExecuteThreadOptions;
  dataJsonlPath: string;
  threadId: string;
  logger: LogFn;
}): Promise<WorkflowResult> {
  const { fn, input, bundleOptions, executeOptions, dataJsonlPath, threadId, logger } = params;
  const gen = fn(input, bundleOptions);
  let written = 0;

  while (true) {
    if (executeOptions.signal.aborted) {
      logger("V8JX4NP2", `thread ${threadId} aborted`);
      return { returnCode: 130, summary: "thread aborted" };
    }

    if (written >= executeOptions.maxRounds) {
      logger("R3CW7YBQ", `thread ${threadId} stopped at maxRounds=${executeOptions.maxRounds}`);
      return {
        returnCode: 0,
        summary: `completed: reached maxRounds (${executeOptions.maxRounds})`,
      };
    }

    const iterResult = await gen.next();

    if (iterResult.done) {
      logger("F3HN8QKP", `thread ${threadId} generator finished`);
      return iterResult.value;
    }

    written++;
    const step = iterResult.value;
    const ts = Date.now();
    await appendDataLine(dataJsonlPath, {
      role: step.role,
      content: step.content,
      meta: step.meta,
      timestamp: ts,
    });

    logger("N7BW4YHQ", `thread ${threadId} wrote role ${step.role}`);

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
      logger("V8JX4NP4", `thread ${threadId} aborted`);
      return { returnCode: 130, summary: "thread aborted" };
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
      },
    },
    timestamp: nowMs,
  };
  if (options.forkSourceThreadId !== null) {
    startRecord.forkFrom = { threadId: options.forkSourceThreadId };
  }

  await appendDataLine(io.dataJsonlPath, startRecord);

  logger("T9HQ2KHM", `thread ${io.threadId} started for workflow ${workflowName}`);

  if (prefilled !== null) {
    for (const row of prefilled) {
      await appendDataLine(io.dataJsonlPath, {
        role: row.role,
        content: row.content,
        meta: row.meta,
        timestamp: row.timestamp,
      });
    }
  }

  if (options.maxRounds <= 0) {
    logger("R3CW7YBQ", `thread ${io.threadId} stopped at maxRounds=${options.maxRounds}`);
    return {
      returnCode: 0,
      summary: `completed: reached maxRounds (${options.maxRounds})`,
    };
  }

  const bundleOptions: WorkflowFnOptions = {
    threadId: io.threadId,
    maxRounds: options.maxRounds,
  };

  return await driveWorkflowGenerator({
    fn,
    input,
    bundleOptions,
    executeOptions: options,
    dataJsonlPath: io.dataJsonlPath,
    threadId: io.threadId,
    logger,
  });
}
