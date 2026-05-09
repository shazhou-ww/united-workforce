import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createCasStore, parseCasThreadNode } from "@uncaged/workflow-cas";
import {
  readThreadsIndex,
  type ThreadHistoryEntry,
  type ThreadIndex,
  walkStateFramesNewestFirst,
} from "@uncaged/workflow-execute";
import { END } from "@uncaged/workflow-runtime";
import { getGlobalCasDir } from "@uncaged/workflow-util";

import { pathExists, readTextFileIfExists } from "./fs-utils.js";
import { readWorkerCtl } from "./worker-spawn.js";

async function readWorkflowNameFromStartHash(
  storageRoot: string,
  startHash: string,
): Promise<string | null> {
  const cas = createCasStore(getGlobalCasDir(storageRoot));
  const yamlText = await cas.get(startHash);
  if (yamlText === null) {
    return null;
  }
  const parsed = parseCasThreadNode(yamlText);
  if (parsed === null || parsed.kind !== "start") {
    return null;
  }
  return parsed.node.payload.name;
}

async function listBundleHashDirs(storageRoot: string): Promise<string[]> {
  const bundlesRoot = join(storageRoot, "bundles");
  if (!(await pathExists(bundlesRoot))) {
    return [];
  }
  const names = await readdir(bundlesRoot);
  const out: string[] = [];
  for (const name of names) {
    const p = join(bundlesRoot, name);
    try {
      const st = await stat(p);
      if (st.isDirectory()) {
        out.push(name);
      }
    } catch {}
  }
  out.sort();
  return out;
}

async function parseHistoryFile(path: string): Promise<ThreadHistoryEntry[]> {
  const text = await readTextFileIfExists(path);
  if (text === null) {
    return [];
  }
  const out: ThreadHistoryEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed) as unknown;
    } catch {
      continue;
    }
    if (raw === null || typeof raw !== "object") {
      continue;
    }
    const rec = raw as Record<string, unknown>;
    const threadId = rec.threadId;
    const head = rec.head;
    const start = rec.start;
    const completedAt = rec.completedAt;
    if (
      typeof threadId !== "string" ||
      typeof head !== "string" ||
      typeof start !== "string" ||
      typeof completedAt !== "number"
    ) {
      continue;
    }
    out.push({ threadId, head, start, completedAt });
  }
  return out;
}

export type RunningThreadRow = {
  threadId: string;
  hash: string;
  workflowName: string | null;
};

export type HistoricalThreadRow = {
  threadId: string;
  hash: string;
  workflowName: string | null;
  /** Active entry from `threads.json` vs completed line from `history/*.jsonl`. */
  source: "active" | "history";
  /** `updatedAt` for active threads; `completedAt` for history (ms since epoch). */
  activityTs: number;
  /** Current CAS head (`threads.json` / history row). */
  head: string;
};

export type ResolvedThreadRecord = {
  threadId: string;
  bundleHash: string;
  bundleDir: string;
  head: string;
  start: string;
  source: "active" | "history";
};

/** Resolve a thread via `threads.json` (active) or `history/*.jsonl` (completed). */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: scans all bundle dirs for thread id
export async function resolveThreadRecord(
  storageRoot: string,
  threadId: string,
): Promise<ResolvedThreadRecord | null> {
  const hashes = await listBundleHashDirs(storageRoot);
  for (const bundleHash of hashes) {
    const bundleDir = join(storageRoot, "bundles", bundleHash);
    let index: ThreadIndex;
    try {
      index = await readThreadsIndex(bundleDir);
    } catch {
      continue;
    }
    const active = index[threadId];
    if (active !== undefined) {
      return {
        threadId,
        bundleHash,
        bundleDir,
        head: active.head,
        start: active.start,
        source: "active",
      };
    }
  }

  for (const bundleHash of hashes) {
    const bundleDir = join(storageRoot, "bundles", bundleHash);
    const histDir = join(bundleDir, "history");
    if (!(await pathExists(histDir))) {
      continue;
    }
    let files: string[];
    try {
      files = await readdir(histDir);
    } catch {
      continue;
    }
    for (const name of files) {
      if (!name.endsWith(".jsonl")) {
        continue;
      }
      const entries = await parseHistoryFile(join(histDir, name));
      for (const e of entries) {
        if (e.threadId === threadId) {
          return {
            threadId,
            bundleHash,
            bundleDir,
            head: e.head,
            start: e.start,
            source: "history",
          };
        }
      }
    }
  }

  return null;
}

export type ThreadHeadTerminal =
  | { kind: "non-terminal" }
  | { kind: "terminal"; returnCode: number };

/** True when the newest frame at `headHash` is `__end__` (workflow finished in CAS). */
export async function readThreadTerminalFromHead(
  storageRoot: string,
  headHash: string,
): Promise<ThreadHeadTerminal> {
  const cas = createCasStore(getGlobalCasDir(storageRoot));
  const frames = await walkStateFramesNewestFirst(cas, headHash);
  const newest = frames[0];
  if (newest === undefined) {
    return { kind: "non-terminal" };
  }
  if (newest.payload.role !== END) {
    return { kind: "non-terminal" };
  }
  const rc = newest.payload.meta.returnCode;
  if (typeof rc !== "number") {
    return { kind: "terminal", returnCode: 1 };
  }
  return { kind: "terminal", returnCode: rc };
}

export type ThreadListStatus = "running" | "active" | "completed" | "failed";

/** Combines `.running` marker with CAS head: stale markers do not imply `running`. */
export async function resolveThreadListStatus(
  storageRoot: string,
  row: HistoricalThreadRow,
  runningMarkerPresent: boolean,
): Promise<ThreadListStatus> {
  const terminal = await readThreadTerminalFromHead(storageRoot, row.head);
  if (terminal.kind === "terminal") {
    return terminal.returnCode !== 0 ? "failed" : "completed";
  }
  if (row.source === "history") {
    return "completed";
  }
  if (runningMarkerPresent) {
    const ctlResult = await readWorkerCtl(storageRoot, row.hash);
    if (ctlResult.ok) {
      try {
        process.kill(ctlResult.value.pid, 0);
        return "running";
      } catch {
        // Worker PID is dead but .running marker remains — crashed thread
        return "failed";
      }
    }
    return "running";
  }
  // No .running marker + no __end__ + source "active" → check if worker is dead (crashed)
  const ctlResult = await readWorkerCtl(storageRoot, row.hash);
  if (ctlResult.ok) {
    try {
      process.kill(ctlResult.value.pid, 0);
    } catch {
      // Worker PID is dead, thread never finished — crashed
      return "failed";
    }
  }
  return "active";
}

async function appendRunningThreadRowIfLive(
  storageRoot: string,
  hash: string,
  threadId: string,
  out: RunningThreadRow[],
): Promise<void> {
  const resolved = await resolveThreadRecord(storageRoot, threadId);
  if (resolved !== null && resolved.bundleHash !== hash) {
    return;
  }
  if (resolved !== null) {
    const terminal = await readThreadTerminalFromHead(storageRoot, resolved.head);
    if (terminal.kind === "terminal") {
      return;
    }
  }
  const workflowName =
    resolved !== null ? await readWorkflowNameFromStartHash(storageRoot, resolved.start) : null;
  out.push({ threadId, hash, workflowName });
}

/** Threads currently executing — identified via `<threadId>.running` markers. */
export async function listRunningThreads(storageRoot: string): Promise<RunningThreadRow[]> {
  const logsRoot = join(storageRoot, "logs");
  if (!(await pathExists(logsRoot))) {
    return [];
  }

  const hashes = await readdir(logsRoot);
  const out: RunningThreadRow[] = [];

  for (const hash of hashes) {
    const dir = join(logsRoot, hash);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    for (const fileName of entries) {
      if (!fileName.endsWith(".running")) {
        continue;
      }
      const threadId = fileName.slice(0, -".running".length);
      await appendRunningThreadRowIfLive(storageRoot, hash, threadId, out);
    }
  }

  out.sort((a, b) => {
    const ha = `${a.hash}/${a.threadId}`;
    const hb = `${b.hash}/${b.threadId}`;
    return ha.localeCompare(hb);
  });

  return out;
}

/**
 * Threads discovered via `threads.json` (active) and `history/*.jsonl` (completed).
 * When `workflowNameFilter` is non-null, only threads whose StartNode `name` matches are returned.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: merges active index + partitioned history
export async function listHistoricalThreads(
  storageRoot: string,
  workflowNameFilter: string | null,
): Promise<HistoricalThreadRow[]> {
  const hashes = await listBundleHashDirs(storageRoot);
  const seen = new Set<string>();
  const out: HistoricalThreadRow[] = [];

  for (const bundleHash of hashes) {
    const bundleDir = join(storageRoot, "bundles", bundleHash);
    let index: ThreadIndex;
    try {
      index = await readThreadsIndex(bundleDir);
    } catch {
      continue;
    }
    for (const threadId of Object.keys(index)) {
      const key = `${bundleHash}/${threadId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const entry = index[threadId];
      if (entry === undefined) {
        continue;
      }
      const workflowName = await readWorkflowNameFromStartHash(storageRoot, entry.start);
      if (workflowNameFilter !== null && workflowName !== workflowNameFilter) {
        continue;
      }
      out.push({
        threadId,
        hash: bundleHash,
        workflowName,
        source: "active",
        activityTs: entry.updatedAt,
        head: entry.head,
      });
    }

    const histDir = join(bundleDir, "history");
    if (!(await pathExists(histDir))) {
      continue;
    }
    let files: string[];
    try {
      files = await readdir(histDir);
    } catch {
      continue;
    }
    for (const name of files) {
      if (!name.endsWith(".jsonl")) {
        continue;
      }
      const entries = await parseHistoryFile(join(histDir, name));
      for (const e of entries) {
        const key = `${bundleHash}/${e.threadId}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        const workflowName = await readWorkflowNameFromStartHash(storageRoot, e.start);
        if (workflowNameFilter !== null && workflowName !== workflowNameFilter) {
          continue;
        }
        out.push({
          threadId: e.threadId,
          hash: bundleHash,
          workflowName,
          source: "history",
          activityTs: e.completedAt,
          head: e.head,
        });
      }
    }
  }

  out.sort((a, b) => {
    const ha = `${a.hash}/${a.threadId}`;
    const hb = `${b.hash}/${b.threadId}`;
    return ha.localeCompare(hb);
  });

  return out;
}

export type LatestThreadTarget = {
  threadId: string;
  bundleHash: string;
  bundleDir: string;
  threadsJsonPath: string;
};

/**
 * Picks the newest thread by StartNode timestamp approximation (`updatedAt` active,
 * else `completedAt` history), falling back to lexical thread id order.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: compares active heads vs history tails
export async function findLatestThreadBundleTarget(
  storageRoot: string,
): Promise<LatestThreadTarget | null> {
  const hashes = await listBundleHashDirs(storageRoot);

  let best: {
    threadId: string;
    bundleHash: string;
    bundleDir: string;
    ts: number;
  } | null = null;

  for (const bundleHash of hashes) {
    const bundleDir = join(storageRoot, "bundles", bundleHash);
    let index: ThreadIndex;
    try {
      index = await readThreadsIndex(bundleDir);
    } catch {
      continue;
    }
    for (const threadId of Object.keys(index)) {
      const ent = index[threadId];
      if (ent === undefined) {
        continue;
      }
      const ts = ent.updatedAt;
      const cand = { threadId, bundleHash, bundleDir, ts };
      if (
        best === null ||
        cand.ts > best.ts ||
        (cand.ts === best.ts &&
          `${cand.bundleHash}/${cand.threadId}` > `${best.bundleHash}/${best.threadId}`)
      ) {
        best = cand;
      }
    }

    const histDir = join(bundleDir, "history");
    if (!(await pathExists(histDir))) {
      continue;
    }
    let files: string[];
    try {
      files = await readdir(histDir);
    } catch {
      continue;
    }
    for (const name of files) {
      if (!name.endsWith(".jsonl")) {
        continue;
      }
      const entries = await parseHistoryFile(join(histDir, name));
      for (const e of entries) {
        const ts = e.completedAt;
        const cand = { threadId: e.threadId, bundleHash, bundleDir, ts };
        if (
          best === null ||
          cand.ts > best.ts ||
          (cand.ts === best.ts &&
            `${cand.bundleHash}/${cand.threadId}` > `${best.bundleHash}/${best.threadId}`)
        ) {
          best = cand;
        }
      }
    }
  }

  if (best === null) {
    return null;
  }

  return {
    threadId: best.threadId,
    bundleHash: best.bundleHash,
    bundleDir: best.bundleDir,
    threadsJsonPath: join(best.bundleDir, "threads.json"),
  };
}
