import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { LogFn } from "./logger.js";
import type { ThreadInput, WorkflowFn, WorkflowResult } from "./types.js";

export type ExecuteThreadIo = {
  threadId: string;
  hash: string;
  dataJsonlPath: string;
  infoJsonlPath: string;
};

export type ExecuteThreadOptions = {
  isDryRun: boolean;
  maxRounds: number;
  signal: AbortSignal;
  /** Invoked after each successful yield (and outer-loop checks); used for pause/resume. */
  awaitAfterEachYield: () => Promise<void>;
};

async function appendDataLine(path: string, record: unknown): Promise<void> {
  const line = `${JSON.stringify(record)}\n`;
  await appendFile(path, line, "utf8");
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

  const nowMs = Date.now();
  const startRecord = {
    name: workflowName,
    hash: io.hash,
    threadId: io.threadId,
    parameters: {
      prompt: input.prompt,
      options: {
        isDryRun: options.isDryRun,
        maxRounds: options.maxRounds,
      },
    },
    timestamp: nowMs,
  };

  await appendDataLine(io.dataJsonlPath, startRecord);

  logger("T9HQ2KHM", `thread ${io.threadId} started for workflow ${workflowName}`);

  if (options.maxRounds <= 0) {
    logger("R3CW7YBQ", `thread ${io.threadId} stopped at maxRounds=${options.maxRounds}`);
    return {
      returnCode: 0,
      summary: `completed: reached maxRounds (${options.maxRounds})`,
    };
  }

  const gen = fn(input, {
    isDryRun: options.isDryRun,
    maxRounds: options.maxRounds,
  });

  let written = 0;

  while (true) {
    if (options.signal.aborted) {
      logger("V8JX4NP2", `thread ${io.threadId} aborted`);
      return { returnCode: 130, summary: "thread aborted" };
    }

    if (written >= options.maxRounds) {
      logger("R3CW7YBQ", `thread ${io.threadId} stopped at maxRounds=${options.maxRounds}`);
      return {
        returnCode: 0,
        summary: `completed: reached maxRounds (${options.maxRounds})`,
      };
    }

    const iterResult = await gen.next();

    if (iterResult.done) {
      logger("F3HN8QKP", `thread ${io.threadId} generator finished`);
      return iterResult.value;
    }

    written++;
    const step = iterResult.value;
    const ts = Date.now();
    await appendDataLine(io.dataJsonlPath, {
      role: step.role,
      content: step.content,
      meta: step.meta,
      timestamp: ts,
    });

    logger("N7BW4YHQ", `thread ${io.threadId} wrote role ${step.role}`);

    await Promise.race([
      options.awaitAfterEachYield(),
      new Promise<void>((resolve) => {
        if (options.signal.aborted) {
          resolve();
          return;
        }
        options.signal.addEventListener("abort", () => resolve(), { once: true });
      }),
    ]);

    if (options.signal.aborted) {
      logger("V8JX4NP4", `thread ${io.threadId} aborted`);
      return { returnCode: 130, summary: "thread aborted" };
    }
  }
}
