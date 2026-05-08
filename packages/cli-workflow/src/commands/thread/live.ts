import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  type CasStore,
  createCasStore,
  getContentMerklePayload,
  getGlobalCasDir,
  tryParseRoleStepRecord,
  tryParseWorkflowResultRecord,
  type WorkflowCompletion,
} from "@uncaged/workflow";

import { printCliError, printCliLine } from "../../cli-output.js";
import { pathExists } from "../../fs-utils.js";
import type { ParsedLiveArgv } from "../../live-argv.js";
import { findLatestThreadDataPath, resolveThreadDataPath } from "../../thread-scan.js";

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

function dimGreyLine(line: string): string {
  if (!shouldUseColor()) {
    return line;
  }
  return `\x1b[2m\x1b[90m${line}\x1b[0m`;
}

export function formatLiveDebugLine(timestampMs: number, tag: string, message: string): string {
  const label = `[${formatLiveTimeLabel(timestampMs)}] [${tag}] ${message.replace(/\n/g, " ")}`;
  return dimGreyLine(label);
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

function printSummary(result: WorkflowCompletion): void {
  printCliLine(`completed: returnCode=${result.returnCode} — ${result.summary}`);
}

type LiveSessionState = {
  sawStart: boolean;
  completed: boolean;
  carry: string;
  contentOffset: number;
};

type InfoLiveState = {
  carry: string;
  contentOffset: number;
};

function tryParseInfoRecord(obj: Record<string, unknown>): {
  tag: string;
  content: string;
  timestamp: number;
} | null {
  const tag = obj.tag;
  const content = obj.content;
  const timestamp = obj.timestamp;
  if (
    typeof tag !== "string" ||
    typeof content !== "string" ||
    typeof timestamp !== "number" ||
    !Number.isFinite(timestamp)
  ) {
    return null;
  }
  return { tag, content, timestamp };
}

async function handleJsonlLine(
  rawLine: string,
  state: LiveSessionState,
  roleFilter: string | null,
  cas: CasStore,
): Promise<{ parseError: string | null; workflowResult: WorkflowCompletion | null }> {
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

  if (roleFilter !== null && roleRow.role !== roleFilter) {
    return { parseError: null, workflowResult: null };
  }

  const payload = await getContentMerklePayload(cas, roleRow.contentHash);
  const content =
    payload !== null ? payload : `(content not in CAS; contentHash=${roleRow.contentHash})`;

  const row: LiveRoleRow = {
    role: roleRow.role,
    content,
    meta: roleRow.meta,
    timestamp: roleRow.timestamp,
  };
  for (const outLine of renderLiveRoleStepLines(row, highlightLiveRole(row.role))) {
    printCliLine(outLine);
  }
  return { parseError: null, workflowResult: null };
}

async function pumpNewContent(
  dataPath: string,
  state: LiveSessionState,
  roleFilter: string | null,
  cas: CasStore,
): Promise<number | null> {
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
    const { parseError, workflowResult } = await handleJsonlLine(line, state, roleFilter, cas);
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

async function pumpNewInfoContent(infoPath: string, state: InfoLiveState): Promise<void> {
  let text: string;
  try {
    text = await readFile(infoPath, "utf8");
  } catch {
    return;
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
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    let rec: unknown;
    try {
      rec = JSON.parse(trimmed) as unknown;
    } catch {
      continue;
    }
    if (rec === null || typeof rec !== "object") {
      continue;
    }
    const parsed = tryParseInfoRecord(rec as Record<string, unknown>);
    if (parsed === null) {
      continue;
    }
    printCliLine(formatLiveDebugLine(parsed.timestamp, parsed.tag, parsed.content));
  }
}

type WatchPumpTask = {
  path: string;
  pump: () => Promise<number | null>;
};

async function runWatchPumpStep(
  settled: () => boolean,
  pump: () => Promise<number | null>,
  closeAll: () => void,
  finish: (code: number) => void,
): Promise<void> {
  if (settled()) {
    return;
  }
  try {
    const code = await pump();
    if (code !== null) {
      closeAll();
      finish(code);
    }
  } catch (e) {
    closeAll();
    throw e instanceof Error ? e : new Error(String(e));
  }
}

function watchLivePaths(params: { tasks: WatchPumpTask[]; signal: AbortSignal }): Promise<number> {
  const { tasks, signal } = params;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (code: number): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(code);
    };

    const pumpChains = new Map<string, Promise<void>>();
    for (const t of tasks) {
      pumpChains.set(t.path, Promise.resolve());
    }

    const watchers: ReturnType<typeof watch>[] = [];

    const closeAll = (): void => {
      for (const w of watchers) {
        w.close();
      }
    };

    function schedulePump(path: string, pump: () => Promise<number | null>): void {
      const prev = pumpChains.get(path) ?? Promise.resolve();
      const next = (async () => {
        await prev;
        await runWatchPumpStep(() => settled, pump, closeAll, finish);
      })();
      pumpChains.set(path, next);
    }

    for (const { path, pump } of tasks) {
      const watcher = watch(path, (eventType) => {
        if (eventType === "rename") {
          return;
        }
        schedulePump(path, pump);
      });
      watchers.push(watcher);
      watcher.on("error", (err: Error) => {
        closeAll();
        reject(err);
      });
    }

    const onAbort = (): void => {
      closeAll();
      finish(0);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    for (const { path, pump } of tasks) {
      schedulePump(path, pump);
    }
  });
}

type LiveThreadTarget = {
  threadId: string;
  dataPath: string;
};

async function resolveLiveThreadTarget(
  storageRoot: string,
  parsed: ParsedLiveArgv,
): Promise<LiveThreadTarget | null> {
  if (parsed.latest) {
    const found = await findLatestThreadDataPath(storageRoot);
    if (found === null) {
      printCliError("live: no threads found");
      return null;
    }
    return found;
  }

  const id = parsed.threadId;
  if (id === null) {
    printCliError("live: internal error: missing thread id");
    return null;
  }
  const resolved = await resolveThreadDataPath(storageRoot, id);
  if (resolved === null) {
    printCliError(`thread not found: ${id}`);
    return null;
  }
  return { threadId: id, dataPath: resolved };
}

async function buildLiveWatchTasks(params: {
  dataPath: string;
  infoPath: string;
  debug: boolean;
  dataState: LiveSessionState;
  infoState: InfoLiveState;
  roleFilter: string | null;
  cas: CasStore;
}): Promise<WatchPumpTask[]> {
  const { dataPath, infoPath, debug, dataState, infoState, roleFilter, cas } = params;
  const tasks: WatchPumpTask[] = [
    {
      path: dataPath,
      pump: () => pumpNewContent(dataPath, dataState, roleFilter, cas),
    },
  ];

  if (debug && (await pathExists(infoPath))) {
    tasks.push({
      path: infoPath,
      pump: async () => {
        await pumpNewInfoContent(infoPath, infoState);
        return null;
      },
    });
  }

  return tasks;
}

export async function cmdLive(storageRoot: string, parsed: ParsedLiveArgv): Promise<number> {
  const target = await resolveLiveThreadTarget(storageRoot, parsed);
  if (target === null) {
    return 1;
  }

  const { threadId, dataPath } = target;
  const roleFilter = parsed.role;
  const infoPath = join(dirname(dataPath), `${threadId}.info.jsonl`);
  const cas = createCasStore(getGlobalCasDir(storageRoot));

  const dataState: LiveSessionState = {
    sawStart: false,
    completed: false,
    carry: "",
    contentOffset: 0,
  };

  const infoState: InfoLiveState = {
    carry: "",
    contentOffset: 0,
  };

  const controller = new AbortController();
  const onSigInt = (): void => {
    controller.abort();
  };
  process.on("SIGINT", onSigInt);

  try {
    const firstData = await pumpNewContent(dataPath, dataState, roleFilter, cas);
    if (firstData === 1) {
      return 1;
    }

    if (parsed.debug && (await pathExists(infoPath))) {
      await pumpNewInfoContent(infoPath, infoState);
    }

    if (firstData === 0 || dataState.completed) {
      return 0;
    }

    const tasks = await buildLiveWatchTasks({
      dataPath,
      infoPath,
      debug: parsed.debug,
      dataState,
      infoState,
      roleFilter,
      cas,
    });

    return await watchLivePaths({ tasks, signal: controller.signal });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    printCliError(`live: ${message}`);
    return 1;
  } finally {
    process.off("SIGINT", onSigInt);
  }
}
