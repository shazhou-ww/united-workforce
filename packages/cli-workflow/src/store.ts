import type { Dirent } from "node:fs";
import { access, appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { BootstrapCapableStore, Hash } from "@ocas/core";
import { createFsStore } from "@ocas/fs";
import type { CasRef, ThreadId, ThreadListItem, ThreadsIndex } from "@uncaged/workflow-protocol";
import { parse, stringify } from "yaml";

import { registerUwfSchemas, type UwfSchemaHashes } from "./schemas.js";

export type WorkflowRegistry = Record<string, CasRef>;

/** A workflow entry discovered from the project-local .workflows/ directory. */
export type ProjectWorkflowEntry = {
  /** Workflow name (from YAML `name` field, equals filename stem). */
  name: string;
  /** Absolute path to the YAML file. */
  filePath: string;
};

/** Extract workflow name from a YAML filename (strip .yaml/.yml extension). */
function stemFromYaml(name: string): string {
  if (name.endsWith(".yaml")) return name.slice(0, -5);
  if (name.endsWith(".yml")) return name.slice(0, -4);
  return name;
}

/** Check if a directory contains an index.yaml or index.yml workflow file. */
async function findIndexWorkflow(
  dir: string,
  dirName: string,
): Promise<ProjectWorkflowEntry | null> {
  for (const indexName of ["index.yaml", "index.yml"]) {
    const indexPath = join(dir, dirName, indexName);
    try {
      await access(indexPath);
      return { name: dirName, filePath: indexPath };
    } catch {
      // not found, try next
    }
  }
  return null;
}

/**
 * Scan a single directory for workflow entries (flat YAML files + folder/index.yaml).
 * Returns discovered entries. Returns empty array if directory does not exist.
 */
async function scanWorkflowDir(dir: string): Promise<ProjectWorkflowEntry[]> {
  let dirents: Dirent[];
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT" || err.code === "ENOTDIR") {
      return [];
    }
    throw e;
  }

  const result: ProjectWorkflowEntry[] = [];
  for (const entry of dirents) {
    if (entry.isFile() && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))) {
      result.push({ name: stemFromYaml(entry.name), filePath: join(dir, entry.name) });
    } else if (entry.isDirectory()) {
      const found = await findIndexWorkflow(dir, entry.name);
      if (found !== null) {
        result.push(found);
      }
    }
  }
  return result;
}

/**
 * Scan `<projectRoot>/.workflow/` (preferred) and `.workflows/` (legacy) for workflow entries.
 * .workflow/ takes priority: if a name is found in both, .workflow/ wins.
 * Returns an empty array if neither directory exists.
 */
export async function discoverProjectWorkflows(
  projectRoot: string,
): Promise<ProjectWorkflowEntry[]> {
  const primary = await scanWorkflowDir(join(projectRoot, ".workflow"));
  const legacy = await scanWorkflowDir(join(projectRoot, ".workflows"));
  const seen = new Set(primary.map((e) => e.name));
  const merged = [...primary];
  for (const entry of legacy) {
    if (!seen.has(entry.name)) {
      merged.push(entry);
    }
  }
  return merged;
}

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

/**
 * Deprecated: Use `getGlobalCasDir()` instead.
 * Returns the old CAS directory for backward compatibility.
 */
export function getCasDir(storageRoot: string): string {
  return join(storageRoot, "cas");
}

/**
 * Returns the global CAS directory shared by all uwf and json-cas tools.
 * Priority: UNCAGED_CAS_DIR environment variable → default ~/.uncaged/json-cas
 */
export function getGlobalCasDir(): string {
  const envPath = process.env.UNCAGED_CAS_DIR;
  if (envPath !== undefined && envPath !== "") {
    return envPath;
  }
  return join(homedir(), ".uncaged", "json-cas");
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
  reason: "completed" | "cancelled" | null;
};

export type UwfStore = {
  storageRoot: string;
  store: BootstrapCapableStore;
  schemas: UwfSchemaHashes;
};

export async function createUwfStore(storageRoot: string): Promise<UwfStore> {
  const casDir = getGlobalCasDir();
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

/**
 * Resolve a workflow name to a project-local YAML file path.
 * Returns null if the name is not found in the local entries.
 */
export function resolveProjectWorkflowFile(
  localEntries: ProjectWorkflowEntry[],
  name: string,
): string | null {
  for (const entry of localEntries) {
    if (entry.name === name) {
      return entry.filePath;
    }
  }
  return null;
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
        const reason = rec.reason;
        const parsedReason = reason === "completed" || reason === "cancelled" ? reason : null;
        lines.push({
          thread: thread as ThreadId,
          workflow,
          head,
          completedAt,
          reason: parsedReason,
        });
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
