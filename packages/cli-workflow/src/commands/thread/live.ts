import { watch } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createCasStore, getContentMerklePayload } from "@uncaged/workflow-cas";
import {
  FORK_BRANCH_ROLE,
  readThreadsIndex,
  type ThreadIndex,
  walkStateFramesNewestFirst,
} from "@uncaged/workflow-execute";
import type { CasStore, WorkflowCompletion } from "@uncaged/workflow-protocol";
import { END } from "@uncaged/workflow-runtime";
import { getGlobalCasDir } from "@uncaged/workflow-util";

import { dimGreyLine, highlightLiveRole } from "../../cli-color.js";
import { printCliError, printCliLine } from "../../cli-output.js";
import { pathExists } from "../../fs-utils.js";
import type { ParsedLiveArgv } from "../../live-argv.js";
import {
  findLatestThreadBundleTarget,
  type LatestThreadTarget,
  resolveThreadRecord,
} from "../../thread-scan.js";
import type { LiveRoleRow } from "./types.js";

export const LIVE_CONTENT_MAX_LINES = 10;

export function formatLiveTimeLabel(timestampMs: number): string {
  const d = new Date(timestampMs);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
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

type InfoLiveState = {
  carry: string;
  contentOffset: number;
};

type CasLiveState = {
  printedHashes: Set<string>;
  lastHead: string | null;
  completionEmitted: boolean;
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

function completionFromEndMeta(meta: Record<string, unknown>): WorkflowCompletion | null {
  const returnCode = meta.returnCode;
  const summary = meta.summary;
  if (typeof returnCode !== "number" || typeof summary !== "string") {
    return null;
  }
  return { returnCode, summary };
}

async function emitRoleStepPrint(params: {
  cas: CasStore;
  role: string;
  contentHash: string;
  meta: Record<string, unknown>;
  timestamp: number;
  roleFilter: string | null;
}): Promise<void> {
  if (params.roleFilter !== null && params.role !== params.roleFilter) {
    return;
  }
  const payload = await getContentMerklePayload(params.cas, params.contentHash);
  const content =
    payload !== null ? payload : `(content not in CAS; contentHash=${params.contentHash})`;

  const row: LiveRoleRow = {
    role: params.role,
    content,
    meta: params.meta,
    timestamp: params.timestamp,
  };
  for (const outLine of renderLiveRoleStepLines(row, highlightLiveRole(row.role))) {
    printCliLine(outLine);
  }
}

async function emitStatesReachableFromHead(params: {
  cas: CasStore;
  headHash: string;
  state: CasLiveState;
  roleFilter: string | null;
}): Promise<WorkflowCompletion | null> {
  const frames = await walkStateFramesNewestFirst(params.cas, params.headHash);
  const chronological = [...frames].reverse();

  for (const fr of chronological) {
    if (params.state.printedHashes.has(fr.hash)) {
      continue;
    }
    params.state.printedHashes.add(fr.hash);

    const role = fr.payload.role;
    if (role === FORK_BRANCH_ROLE) {
      continue;
    }

    if (role === END) {
      const wf = completionFromEndMeta(fr.payload.meta);
      if (wf !== null) {
        printSummary(wf);
        return wf;
      }
      continue;
    }

    await emitRoleStepPrint({
      cas: params.cas,
      role,
      contentHash: fr.payload.content,
      meta: fr.payload.meta,
      timestamp: fr.payload.timestamp,
      roleFilter: params.roleFilter,
    });
  }

  return null;
}

async function pumpThreadsJson(params: {
  storageRoot: string;
  bundleDir: string;
  bundleHash: string;
  threadId: string;
  state: CasLiveState;
  roleFilter: string | null;
  cas: CasStore;
}): Promise<number | null> {
  let idx: ThreadIndex;
  try {
    idx = await readThreadsIndex(params.bundleDir);
  } catch {
    idx = {};
  }

  const active = idx[params.threadId];

  if (active === undefined) {
    if (params.state.completionEmitted) {
      return null;
    }
    const hist = await resolveThreadRecord(params.storageRoot, params.threadId);
    if (hist === null || hist.source !== "history") {
      return null;
    }
    params.state.completionEmitted = true;
    const wf = await emitStatesReachableFromHead({
      cas: params.cas,
      headHash: hist.head,
      state: params.state,
      roleFilter: params.roleFilter,
    });
    return wf !== null ? 0 : null;
  }

  const head = active.head;
  if (params.state.lastHead === null) {
    params.state.lastHead = head;
    const wf = await emitStatesReachableFromHead({
      cas: params.cas,
      headHash: head,
      state: params.state,
      roleFilter: params.roleFilter,
    });
    return wf !== null ? 0 : null;
  }

  if (head !== params.state.lastHead) {
    params.state.lastHead = head;
    const wf = await emitStatesReachableFromHead({
      cas: params.cas,
      headHash: head,
      state: params.state,
      roleFilter: params.roleFilter,
    });
    return wf !== null ? 0 : null;
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
      watcher.on("error", (errObj: Error) => {
        closeAll();
        reject(errObj);
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

type LiveThreadTarget = LatestThreadTarget;

async function resolveLiveThreadTarget(
  storageRoot: string,
  parsed: ParsedLiveArgv,
): Promise<LiveThreadTarget | null> {
  if (parsed.latest) {
    const found = await findLatestThreadBundleTarget(storageRoot);
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
  const resolved = await resolveThreadRecord(storageRoot, id);
  if (resolved === null) {
    printCliError(`thread not found: ${id}`);
    return null;
  }
  return {
    threadId: id,
    bundleHash: resolved.bundleHash,
    bundleDir: resolved.bundleDir,
    threadsJsonPath: join(resolved.bundleDir, "threads.json"),
  };
}

async function buildLiveWatchTasks(params: {
  storageRoot: string;
  target: LiveThreadTarget;
  debug: boolean;
  dataState: CasLiveState;
  infoState: InfoLiveState;
  roleFilter: string | null;
  cas: CasStore;
}): Promise<WatchPumpTask[]> {
  const infoPath = join(
    params.storageRoot,
    "logs",
    params.target.bundleHash,
    `${params.target.threadId}.info.jsonl`,
  );

  const tasks: WatchPumpTask[] = [
    {
      path: params.target.threadsJsonPath,
      pump: () =>
        pumpThreadsJson({
          storageRoot: params.storageRoot,
          bundleDir: params.target.bundleDir,
          bundleHash: params.target.bundleHash,
          threadId: params.target.threadId,
          state: params.dataState,
          roleFilter: params.roleFilter,
          cas: params.cas,
        }),
    },
  ];

  if (params.debug && (await pathExists(infoPath))) {
    tasks.push({
      path: infoPath,
      pump: async () => {
        await pumpNewInfoContent(infoPath, params.infoState);
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

  const roleFilter = parsed.role;
  const cas = createCasStore(getGlobalCasDir(storageRoot));

  const dataState: CasLiveState = {
    printedHashes: new Set<string>(),
    lastHead: null,
    completionEmitted: false,
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
    await mkdir(dirname(target.threadsJsonPath), { recursive: true });

    const firstData = await pumpThreadsJson({
      storageRoot,
      bundleDir: target.bundleDir,
      bundleHash: target.bundleHash,
      threadId: target.threadId,
      state: dataState,
      roleFilter,
      cas,
    });
    const infoPath = join(storageRoot, "logs", target.bundleHash, `${target.threadId}.info.jsonl`);
    if (parsed.debug && (await pathExists(infoPath))) {
      await pumpNewInfoContent(infoPath, infoState);
    }

    if (firstData === 0) {
      return 0;
    }

    const tasks = await buildLiveWatchTasks({
      storageRoot,
      target,
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
