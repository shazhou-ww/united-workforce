import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { LogFn } from "./logger.js";
import {
  END,
  type RoleMeta,
  type RoleStep,
  START,
  type ThreadContext,
  type WorkflowDefinition,
} from "./types.js";

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
};

function isRoleNext<M extends RoleMeta>(
  next: (keyof M & string) | typeof END,
): next is keyof M & string {
  return next !== END;
}

async function appendDataLine(path: string, record: unknown): Promise<void> {
  const line = `${JSON.stringify(record)}\n`;
  await appendFile(path, line, "utf8");
}

/**
 * Execute a workflow thread: moderator loop, role steps, RFC-001 `.data.jsonl` records,
 * debug lines via `logger` to `.info.jsonl`.
 */
export async function executeThread<M extends RoleMeta>(
  def: WorkflowDefinition<M>,
  prompt: string,
  options: ExecuteThreadOptions,
  io: ExecuteThreadIo,
  logger: LogFn,
): Promise<{ returnCode: number; summary: string }> {
  await mkdir(dirname(io.dataJsonlPath), { recursive: true });
  await mkdir(dirname(io.infoJsonlPath), { recursive: true });

  const nowMs = Date.now();
  const start: ThreadContext<M>["start"] = {
    role: START,
    content: prompt,
    meta: { maxRounds: options.maxRounds, threadId: io.threadId },
    timestamp: nowMs,
  };

  const startRecord = {
    name: def.name,
    hash: io.hash,
    threadId: io.threadId,
    parameters: {
      prompt,
      options: {
        isDryRun: options.isDryRun,
        maxRounds: options.maxRounds,
      },
    },
    timestamp: nowMs,
  };

  await appendDataLine(io.dataJsonlPath, startRecord);

  let steps: RoleStep<M>[] = [];

  logger("T9HQ2KHM", `thread ${io.threadId} started for workflow ${def.name}`);

  while (true) {
    if (options.signal.aborted) {
      logger("V8JX4NP2", `thread ${io.threadId} aborted`);
      return { returnCode: 130, summary: "thread aborted" };
    }

    if (steps.length >= options.maxRounds) {
      logger("R3CW7YBQ", `thread ${io.threadId} stopped at maxRounds=${options.maxRounds}`);
      return {
        returnCode: 0,
        summary: `completed: reached maxRounds (${options.maxRounds})`,
      };
    }

    const ctx: ThreadContext<M> = {
      threadId: io.threadId,
      start,
      steps,
    };

    const next = def.moderator(ctx);

    if (!isRoleNext(next)) {
      logger("M5FZ2K8H", `thread ${io.threadId} moderator returned END`);
      return { returnCode: 0, summary: "completed: moderator returned END" };
    }

    const roleFn = def.roles[next];
    if (roleFn === undefined) {
      logger("K2P8QX9W", `thread ${io.threadId} unknown role ${next}`);
      return { returnCode: 1, summary: `unknown role: ${next}` };
    }

    if (options.signal.aborted) {
      logger("V8JX4NP3", `thread ${io.threadId} aborted`);
      return { returnCode: 130, summary: "thread aborted" };
    }

    const result = await roleFn(ctx);

    const ts = Date.now();
    const step: RoleStep<M> = {
      role: next,
      content: result.content,
      meta: result.meta,
      timestamp: ts,
    } as RoleStep<M>;

    await appendDataLine(io.dataJsonlPath, {
      role: step.role,
      content: step.content,
      meta: step.meta,
      timestamp: step.timestamp,
    });

    steps = [...steps, step];
    logger("N7BW4YHQ", `thread ${io.threadId} completed role ${next}`);

    if (options.signal.aborted) {
      logger("V8JX4NP4", `thread ${io.threadId} aborted`);
      return { returnCode: 130, summary: "thread aborted" };
    }
  }
}
