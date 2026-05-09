import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Active-thread index entry stored in `<bundleDir>/threads.json`.
 *
 * Once the thread reaches `__end__`, the entry is removed from `threads.json`
 * and a corresponding line is appended to `history/{YYYY-MM-DD}.jsonl`.
 */
export type ThreadIndexEntry = {
  head: string;
  start: string;
  updatedAt: number;
};

export type ThreadHistoryEntry = {
  threadId: string;
  head: string;
  start: string;
  completedAt: number;
};

export type ThreadIndex = Record<string, ThreadIndexEntry>;

export function getBundleDir(storageRoot: string, bundleHash: string): string {
  return join(storageRoot, "bundles", bundleHash);
}

function threadsJsonPath(bundleDir: string): string {
  return join(bundleDir, "threads.json");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function parseThreadIndexEntry(raw: unknown): ThreadIndexEntry | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  const head = raw.head;
  const start = raw.start;
  const updatedAt = raw.updatedAt;
  if (typeof head !== "string" || typeof start !== "string" || typeof updatedAt !== "number") {
    return null;
  }
  return { head, start, updatedAt };
}

function parseThreadIndex(text: string): ThreadIndex {
  const trimmed = text.trim();
  if (trimmed === "") {
    return {};
  }
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed) as unknown;
  } catch {
    return {};
  }
  if (!isPlainObject(raw)) {
    return {};
  }
  const out: ThreadIndex = {};
  for (const [k, v] of Object.entries(raw)) {
    const entry = parseThreadIndexEntry(v);
    if (entry !== null) {
      out[k] = entry;
    }
  }
  return out;
}

async function readThreadIndex(bundleDir: string): Promise<ThreadIndex> {
  const path = threadsJsonPath(bundleDir);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    const errObj = e as NodeJS.ErrnoException;
    if (errObj.code === "ENOENT") {
      return {};
    }
    throw e;
  }
  return parseThreadIndex(text);
}

async function writeThreadIndex(bundleDir: string, index: ThreadIndex): Promise<void> {
  const path = threadsJsonPath(bundleDir);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  const json = `${JSON.stringify(index, null, 2)}\n`;
  await writeFile(tmp, json, "utf8");
  await rename(tmp, path);
}

/** Insert/update a thread entry in `threads.json`. */
export async function upsertThreadEntry(
  bundleDir: string,
  threadId: string,
  entry: ThreadIndexEntry,
): Promise<void> {
  const index = await readThreadIndex(bundleDir);
  index[threadId] = entry;
  await writeThreadIndex(bundleDir, index);
}

/** Remove a thread entry from `threads.json` (no-op when absent). */
export async function removeThreadEntry(bundleDir: string, threadId: string): Promise<void> {
  const index = await readThreadIndex(bundleDir);
  if (!(threadId in index)) {
    return;
  }
  delete index[threadId];
  await writeThreadIndex(bundleDir, index);
}

function dateKey(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Append a completion record to `history/{YYYY-MM-DD}.jsonl` keyed off `completedAt`. */
export async function appendThreadHistoryEntry(
  bundleDir: string,
  entry: ThreadHistoryEntry,
): Promise<void> {
  const path = join(bundleDir, "history", `${dateKey(entry.completedAt)}.jsonl`);
  await mkdir(dirname(path), { recursive: true });
  const line = `${JSON.stringify(entry)}\n`;
  await appendFile(path, line, "utf8");
}
