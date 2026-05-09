import type { Stats } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { type CasStore, createCasStore, findReachableHashes } from "@uncaged/workflow-cas";
import { err, getGlobalCasDir, ok, type Result } from "@uncaged/workflow-util";

import type { ThreadHistoryEntry, ThreadIndex } from "./threads-index.js";
import { readThreadsIndex } from "./threads-index.js";
import type { GcResult } from "./types.js";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function parseHistoryLine(jsonLine: string): ThreadHistoryEntry | null {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonLine) as unknown;
  } catch {
    return null;
  }
  if (!isPlainObject(raw)) {
    return null;
  }
  const threadId = raw.threadId;
  const head = raw.head;
  const start = raw.start;
  const completedAt = raw.completedAt;
  if (
    typeof threadId !== "string" ||
    typeof head !== "string" ||
    typeof start !== "string" ||
    typeof completedAt !== "number"
  ) {
    return null;
  }
  return { threadId, head, start, completedAt };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: walks threads index + optional history dir
async function collectGcRootsFromBundle(bundleDir: string): Promise<Result<string[], string>> {
  const roots: string[] = [];

  let activeIndex: ThreadIndex;
  try {
    activeIndex = await readThreadsIndex(bundleDir);
  } catch (e) {
    return err(`failed to read threads.json under ${bundleDir}: ${String(e)}`);
  }

  for (const entry of Object.values(activeIndex)) {
    roots.push(entry.head);
    roots.push(entry.start);
  }

  const histDir = join(bundleDir, "history");
  let histFiles: string[];
  try {
    histFiles = await readdir(histDir);
  } catch (e) {
    const errObj = e as NodeJS.ErrnoException;
    if (errObj.code === "ENOENT") {
      return ok(roots);
    }
    return err(`failed to read history directory ${histDir}: ${String(e)}`);
  }

  for (const name of histFiles) {
    if (!name.endsWith(".jsonl")) {
      continue;
    }
    let text: string;
    try {
      text = await readFile(join(histDir, name), "utf8");
    } catch (e) {
      return err(`failed to read history file ${name}: ${String(e)}`);
    }
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "") {
        continue;
      }
      const entry = parseHistoryLine(trimmed);
      if (entry === null) {
        continue;
      }
      roots.push(entry.head);
      roots.push(entry.start);
    }
  }

  return ok(roots);
}

async function collectAllGcRoots(storageRoot: string): Promise<Result<string[], string>> {
  const bundlesRoot = join(storageRoot, "bundles");
  let entries: string[];
  try {
    entries = await readdir(bundlesRoot);
  } catch (e) {
    const errObj = e as NodeJS.ErrnoException;
    if (errObj.code === "ENOENT") {
      return ok([]);
    }
    return err(`failed to read bundles directory: ${String(e)}`);
  }

  const roots: string[] = [];
  for (const name of entries) {
    const bundleDir = join(bundlesRoot, name);
    let st: Stats;
    try {
      st = await stat(bundleDir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) {
      continue;
    }
    const chunk = await collectGcRootsFromBundle(bundleDir);
    if (!chunk.ok) {
      return chunk;
    }
    roots.push(...chunk.value);
  }

  return ok(roots);
}

async function deleteCasNotMarked(cas: CasStore, marked: ReadonlySet<string>): Promise<string[]> {
  let listed: string[];
  try {
    listed = await cas.list();
  } catch (e) {
    throw new Error(`failed to list cas entries: ${String(e)}`);
  }

  const deletedHashes: string[] = [];
  for (const hash of listed) {
    if (marked.has(hash)) {
      continue;
    }
    try {
      await cas.delete(hash);
    } catch (e) {
      throw new Error(`failed to delete cas ${hash}: ${String(e)}`);
    }
    deletedHashes.push(hash);
  }

  deletedHashes.sort();
  return deletedHashes;
}

/**
 * Mark-and-sweep CAS GC: roots are every `head` / `start` hash from `threads.json` and
 * `history/*.jsonl` across bundle dirs; marks closure via `refs[]`; deletes unreachable blobs.
 */
export async function garbageCollectCas(storageRoot: string): Promise<Result<GcResult, string>> {
  const rootsResult = await collectAllGcRoots(storageRoot);
  if (!rootsResult.ok) {
    return rootsResult;
  }
  const roots = rootsResult.value;

  const cas = createCasStore(getGlobalCasDir(storageRoot));

  const marked = await findReachableHashes(roots, cas);

  let deletedHashes: string[];
  try {
    deletedHashes = await deleteCasNotMarked(cas, marked);
  } catch (e) {
    return err(String(e));
  }

  return ok({
    scannedThreads: roots.length,
    activeRefs: marked.size,
    deletedEntries: deletedHashes.length,
    deletedHashes,
  });
}
