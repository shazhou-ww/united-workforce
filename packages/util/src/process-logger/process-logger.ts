import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { getDefaultStorageRoot } from "../storage-root.js";
import { assertValidLogTag } from "./log-tag.js";
import type { CreateProcessLoggerOptions, ProcessLogger, ProcessLoggerContext } from "./types.js";

const INIT_TAG = "W9F3RK2M";

function logDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getProcessLogsDir(storageRoot: string): string {
  return join(storageRoot, "logs");
}

function getProcessLogFilePath(storageRoot: string, date: Date): string {
  return join(getProcessLogsDir(storageRoot), `${logDateKey(date)}.jsonl`);
}

function buildEntry(
  processId: string,
  tag: string,
  msg: string,
  baseContext: ProcessLoggerContext,
  extra: Record<string, string> | null,
): Record<string, string> {
  const entry: Record<string, string> = {
    ts: new Date().toISOString(),
    pid: processId,
    tag: tag.toUpperCase(),
    msg,
  };
  if (baseContext.thread !== null) {
    entry.thread = baseContext.thread;
  }
  if (baseContext.workflow !== null) {
    entry.workflow = baseContext.workflow;
  }
  if (extra !== null) {
    for (const [key, value] of Object.entries(extra)) {
      entry[key] = value;
    }
  }
  return entry;
}

function appendEntry(filePath: string, entry: Record<string, string>): void {
  appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf8");
}

/** Process-scoped debug logger — append-only JSONL under `<storageRoot>/logs/YYYY-MM-DD.jsonl`. */
export function createProcessLogger(options: CreateProcessLoggerOptions): ProcessLogger {
  const storageRoot = options.storageRoot ?? getDefaultStorageRoot();
  const processId = `${Date.now()}-${process.pid}`;
  const baseContext = options.context;
  const logFilePath = getProcessLogFilePath(storageRoot, new Date());

  mkdirSync(getProcessLogsDir(storageRoot), { recursive: true });

  const log: ProcessLogger["log"] = (tag, msg, context = null) => {
    assertValidLogTag(tag);
    appendEntry(logFilePath, buildEntry(processId, tag, msg, baseContext, context));
  };

  const argvSummary = JSON.stringify(process.argv);
  const initParts = [`argv=${argvSummary}`, `node=${process.version}`];
  if (baseContext.thread !== null) {
    initParts.push(`thread=${baseContext.thread}`);
  }
  if (baseContext.workflow !== null) {
    initParts.push(`workflow=${baseContext.workflow}`);
  }
  log(INIT_TAG, `process start ${initParts.join(" ")}`, null);

  return { pid: processId, log };
}
