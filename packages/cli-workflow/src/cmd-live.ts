import { watch } from "node:fs";
import { readFile } from "node:fs/promises";

import {
  tryParseRoleStepRecord,
  tryParseWorkflowResultRecord,
  type WorkflowResult,
} from "@uncaged/workflow";

import { printCliError, printCliLine } from "./cli-output.js";
import { resolveThreadDataPath } from "./thread-scan.js";

export const LIVE_CONTENT_MAX_LINES = 10;

export type LiveRoleRow = {
  role: string;
  content: string;
  meta: Record<string, unknown>;
  timestamp: number;
};

export function formatLiveTimeLabel(timestampMs: number): string {
  const d = new Date(timestampMs);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function shouldUseColor(): boolean {
  return process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
}

function highlightLiveRole(name: string): string {
  if (!shouldUseColor()) {
    return name;
  }
  return `\x1b[1m\x1b[36m${name}\x1b[0m`;
}

export function renderLiveRoleStepLines(row: LiveRoleRow, roleDisplay: string): string[] {
  const header = `[${formatLiveTimeLabel(row.timestamp)}] ▶ ${roleDisplay}`;
  const lines: string[] = [header];
  const parts = row.content.split("\n");
  const shown = parts.slice(0, LIVE_CONTENT_MAX_LINES);
  for (const ln of shown) {
    lines.push(`  ${ln}`);
  }
  const omitted = parts.length - shown.length;
  if (omitted > 0) {
    lines.push(`  … (${omitted} more line${omitted === 1 ? "" : "s"})`);
  }
  lines.push(`  meta: ${JSON.stringify(row.meta)}`);
  return lines;
}

function printSummary(result: WorkflowResult): void {
  printCliLine(`completed: returnCode=${result.returnCode} — ${result.summary}`);
}

type LiveSessionState = {
  sawStart: boolean;
  completed: boolean;
  carry: string;
  contentOffset: number;
};

function handleJsonlLine(
  rawLine: string,
  state: LiveSessionState,
): { parseError: string | null; workflowResult: WorkflowResult | null } {
  const trimmed = rawLine.trim();
  if (trimmed === "") {
    return { parseError: null, workflowResult: null };
  }

  let rec: unknown;
  try {
    rec = JSON.parse(trimmed) as unknown;
  } catch {
    return { parseError: "invalid JSON in thread data file", workflowResult: null };
  }
  if (rec === null || typeof rec !== "object") {
    return { parseError: "invalid record in thread data file", workflowResult: null };
  }
  const obj = rec as Record<string, unknown>;

  if (!state.sawStart) {
    state.sawStart = true;
    return { parseError: null, workflowResult: null };
  }

  const wf = tryParseWorkflowResultRecord(obj);
  if (wf !== null) {
    state.completed = true;
    return { parseError: null, workflowResult: wf };
  }

  const roleRow = tryParseRoleStepRecord(obj);
  if (roleRow === null) {
    return {
      parseError: "unrecognized record in thread data (expected role step or result)",
      workflowResult: null,
    };
  }

  const row: LiveRoleRow = {
    role: roleRow.role,
    content: roleRow.content,
    meta: roleRow.meta,
    timestamp: roleRow.timestamp,
  };
  for (const outLine of renderLiveRoleStepLines(row, highlightLiveRole(row.role))) {
    printCliLine(outLine);
  }
  return { parseError: null, workflowResult: null };
}

async function pumpNewContent(dataPath: string, state: LiveSessionState): Promise<number | null> {
  let text: string;
  try {
    text = await readFile(dataPath, "utf8");
  } catch {
    return null;
  }

  if (text.length < state.contentOffset) {
    state.contentOffset = 0;
    state.carry = "";
  }

  const chunk = text.slice(state.contentOffset);
  state.contentOffset = text.length;
  state.carry += chunk;

  const parts = state.carry.split("\n");
  state.carry = parts.pop() ?? "";

  for (const line of parts) {
    const { parseError, workflowResult } = handleJsonlLine(line, state);
    if (parseError !== null) {
      printCliError(parseError);
      return 1;
    }
    if (workflowResult !== null) {
      printSummary(workflowResult);
      return 0;
    }
  }

  return null;
}

function watchLiveFile(params: {
  dataPath: string;
  state: LiveSessionState;
  signal: AbortSignal;
}): Promise<number> {
  const { dataPath, state, signal } = params;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (code: number): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(code);
    };

    /** Serialize reads — `fs.watch` may emit faster than `readFile` completes. */
    let pumpChain: Promise<void> = Promise.resolve();

    const watcher = watch(dataPath, (eventType) => {
      if (eventType === "rename") {
        return;
      }
      schedulePump();
    });

    watcher.on("error", (err: Error) => {
      watcher.close();
      reject(err);
    });

    const onAbort = (): void => {
      watcher.close();
      finish(0);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    async function drainQueuedPump(): Promise<void> {
      if (settled) {
        return;
      }
      try {
        const code = await pumpNewContent(dataPath, state);
        if (code !== null) {
          watcher.close();
          finish(code);
        }
      } catch (e) {
        watcher.close();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    }

    function schedulePump(): void {
      pumpChain = pumpChain.then(() => drainQueuedPump());
    }

    schedulePump();
  });
}

export async function cmdLive(storageRoot: string, threadId: string): Promise<number> {
  const dataPath = await resolveThreadDataPath(storageRoot, threadId);
  if (dataPath === null) {
    printCliError(`thread not found: ${threadId}`);
    return 1;
  }

  const state: LiveSessionState = {
    sawStart: false,
    completed: false,
    carry: "",
    contentOffset: 0,
  };

  const controller = new AbortController();
  const onSigInt = (): void => {
    controller.abort();
  };
  process.on("SIGINT", onSigInt);

  try {
    const first = await pumpNewContent(dataPath, state);
    if (first !== null) {
      return first;
    }

    if (state.completed) {
      return 0;
    }

    return await watchLiveFile({ dataPath, state, signal: controller.signal });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    printCliError(`live: ${message}`);
    return 1;
  } finally {
    process.off("SIGINT", onSigInt);
  }
}
