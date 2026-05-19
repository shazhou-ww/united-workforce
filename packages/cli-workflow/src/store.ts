import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Hash, Store } from "@uncaged/json-cas";
import { createFsStore } from "@uncaged/json-cas-fs";
import type { CasRef, ThreadId, ThreadListItem, ThreadsIndex } from "@uncaged/workflow-protocol";
import { parse, stringify } from "yaml";

import { registerUwfSchemas, type UwfSchemaHashes } from "./schemas.js";

export type WorkflowRegistry = Record<string, CasRef>;

/** Default filesystem root for uwf data (`~/.uncaged/workflow`). */
export function getDefaultStorageRoot(): string {
  return join(homedir(), ".uncaged", "workflow");
}

/**
 * Resolve storage root.
 * Priority: `UNCAGED_WORKFLOW_STORAGE_ROOT` → `WORKFLOW_STORAGE_ROOT` → default.
 */
export function resolveStorageRoot(): string {
  const internal = process.env.UNCAGED_WORKFLOW_STORAGE_ROOT;
  if (internal !== undefined && internal !== "") {
    return internal;
  }
  const userOverride = process.env.WORKFLOW_STORAGE_ROOT;
  if (userOverride !== undefined && userOverride !== "") {
    return userOverride;
  }
  return getDefaultStorageRoot();
}

export function getCasDir(storageRoot: string): string {
  return join(storageRoot, "cas");
}

export function getRegistryPath(storageRoot: string): string {
  return join(storageRoot, "workflows.yaml");
}

export function getThreadsPath(storageRoot: string): string {
  return join(storageRoot, "threads.yaml");
}

export function getHistoryPath(storageRoot: string): string {
  return join(storageRoot, "history.jsonl");
}

export type ThreadHistoryLine = ThreadListItem & {
  completedAt: number;
};

export type UwfStore = {
  storageRoot: string;
  store: Store;
  schemas: UwfSchemaHashes;
};

export async function createUwfStore(storageRoot: string): Promise<UwfStore> {
  const casDir = getCasDir(storageRoot);
  await mkdir(casDir, { recursive: true });
  const store = createFsStore(casDir);
  const schemas = await registerUwfSchemas(store);
  return { storageRoot, store, schemas };
}

export async function loadWorkflowRegistry(storageRoot: string): Promise<WorkflowRegistry> {
  const path = getRegistryPath(storageRoot);
  try {
    const text = await readFile(path, "utf8");
    const raw = parse(text) as unknown;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return {};
    }
    const registry: WorkflowRegistry = {};
    for (const [name, hash] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof hash === "string") {
        registry[name] = hash;
      }
    }
    return registry;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return {};
    }
    throw e;
  }
}

export async function saveWorkflowRegistry(
  storageRoot: string,
  registry: WorkflowRegistry,
): Promise<void> {
  const path = getRegistryPath(storageRoot);
  await mkdir(storageRoot, { recursive: true });
  const text = stringify(registry, { indent: 2 });
  await writeFile(path, text, "utf8");
}

export function resolveWorkflowHash(registry: WorkflowRegistry, id: string): CasRef {
  return registry[id] !== undefined ? registry[id] : id;
}

export function findRegistryName(registry: WorkflowRegistry, hash: Hash): string | null {
  for (const [name, h] of Object.entries(registry)) {
    if (h === hash) {
      return name;
    }
  }
  return null;
}

export async function loadThreadsIndex(storageRoot: string): Promise<ThreadsIndex> {
  const path = getThreadsPath(storageRoot);
  try {
    const text = await readFile(path, "utf8");
    const raw = parse(text) as unknown;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return {};
    }
    const index: ThreadsIndex = {};
    for (const [threadId, head] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof head === "string") {
        index[threadId as ThreadId] = head;
      }
    }
    return index;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return {};
    }
    throw e;
  }
}

export async function saveThreadsIndex(storageRoot: string, index: ThreadsIndex): Promise<void> {
  const path = getThreadsPath(storageRoot);
  await mkdir(storageRoot, { recursive: true });
  const text = stringify(index, { indent: 2 });
  await writeFile(path, text, "utf8");
}

export async function loadThreadHistory(storageRoot: string): Promise<ThreadHistoryLine[]> {
  const path = getHistoryPath(storageRoot);
  try {
    const text = await readFile(path, "utf8");
    const lines: ThreadHistoryLine[] = [];
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
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        continue;
      }
      const rec = raw as Record<string, unknown>;
      const thread = rec.thread;
      const workflow = rec.workflow;
      const head = rec.head;
      const completedAt = rec.completedAt;
      if (
        typeof thread === "string" &&
        typeof workflow === "string" &&
        typeof head === "string" &&
        typeof completedAt === "number"
      ) {
        lines.push({ thread: thread as ThreadId, workflow, head, completedAt });
      }
    }
    return lines;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return [];
    }
    throw e;
  }
}

export async function findThreadInHistory(
  storageRoot: string,
  threadId: ThreadId,
): Promise<ThreadHistoryLine | null> {
  const history = await loadThreadHistory(storageRoot);
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry !== undefined && entry.thread === threadId) {
      return entry;
    }
  }
  return null;
}

export async function appendThreadHistory(
  storageRoot: string,
  entry: ThreadHistoryLine,
): Promise<void> {
  const path = getHistoryPath(storageRoot);
  await mkdir(storageRoot, { recursive: true });
  const line = `${JSON.stringify(entry)}\n`;
  await appendFile(path, line, "utf8");
}
