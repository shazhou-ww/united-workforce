import type { Dirent } from "node:fs";
import { existsSync, symlinkSync } from "node:fs";
import { access, mkdir, readdir, readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { BootstrapCapableStore, Hash } from "@ocas/core";
import { createVariableStore, type VariableStore } from "@ocas/core";
import { createFsStore } from "@ocas/fs";
import type {
  CasRef,
  ThreadId,
  ThreadIndexEntry,
  ThreadListItem,
  ThreadsIndex,
} from "@united-workforce/protocol";
import { parseThreadsIndex } from "@united-workforce/protocol";
import { parse } from "yaml";

import { registerUwfSchemas, type UwfSchemaHashes } from "./schemas.js";

export type WorkflowRegistry = Record<string, CasRef>;

/** Variable name prefix for workflow registry entries (`@uwf/registry/<name>`). */
export const REGISTRY_VAR_PREFIX = "@uwf/registry/";

/** Variable name prefix for active thread entries (`@uwf/thread/<thread-id>`). */
export const THREAD_VAR_PREFIX = "@uwf/thread/";

/** Variable name prefix for completed/cancelled thread history (`@uwf/history/<thread-id>`). */
export const HISTORY_VAR_PREFIX = "@uwf/history/";

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

/** Default filesystem root for uwf data (`~/.uwf`). */
export function getDefaultStorageRoot(): string {
  return join(homedir(), ".uwf");
}

/**
 * Resolve storage root.
 * Priority: `UWF_STORAGE_ROOT` → `WORKFLOW_STORAGE_ROOT` → default.
 */
export function resolveStorageRoot(): string {
  const primary = process.env.UWF_STORAGE_ROOT;
  if (primary !== undefined && primary !== "") {
    return primary;
  }
  const userOverride = process.env.WORKFLOW_STORAGE_ROOT;
  if (userOverride !== undefined && userOverride !== "") {
    return userOverride;
  }
  return getDefaultStorageRoot();
}

/** Symlink legacy storage paths to ~/.uwf and ~/.ocas when upgrading from older installs. */
export function migrateStorageIfNeeded(home: string = homedir()): void {
  const oldPath = join(home, ".uncaged", "workflow");
  const newPath = join(home, ".uwf");

  if (!existsSync(newPath) && existsSync(oldPath)) {
    symlinkSync(oldPath, newPath);
    // biome-ignore lint/suspicious/noConsole: migration notice
    console.log("⚠️  Storage linked: ~/.uwf → legacy workflow directory (symlink)");
    // biome-ignore lint/suspicious/noConsole: migration notice
    console.log(
      "   This symlink is temporary. Copy your data to ~/.uwf/ and remove the symlink in a future version.",
    );
  }

  const oldCas = join(home, ".uncaged", "json-cas");
  const newCas = join(home, ".ocas");
  if (!existsSync(newCas) && existsSync(oldCas)) {
    symlinkSync(oldCas, newCas);
    // biome-ignore lint/suspicious/noConsole: migration notice
    console.log("⚠️  CAS storage linked: ~/.ocas → legacy CAS directory (symlink)");
  }
}

/**
 * Deprecated: Use `getGlobalCasDir()` instead.
 * Returns the old CAS directory for backward compatibility.
 */
export function getCasDir(storageRoot: string): string {
  return join(storageRoot, "cas");
}

/**
 * Returns the global CAS directory shared by all uwf and ocas tools.
 * Priority: `OCAS_DIR` → default ~/.ocas
 */
export function getGlobalCasDir(): string {
  const primary = process.env.OCAS_DIR;
  if (primary !== undefined && primary !== "") {
    return primary;
  }
  return join(homedir(), ".ocas");
}

export function getRegistryPath(storageRoot: string): string {
  return join(storageRoot, "workflows.yaml");
}

export function getThreadsPath(storageRoot: string): string {
  return join(storageRoot, "threads.yaml");
}

export type ThreadHistoryLine = ThreadListItem & {
  completedAt: number;
  reason: "completed" | "cancelled" | null;
};

export type UwfStore = {
  storageRoot: string;
  store: BootstrapCapableStore;
  schemas: UwfSchemaHashes;
  varStore: VariableStore;
};

export async function createUwfStore(storageRoot: string): Promise<UwfStore> {
  const casDir = getGlobalCasDir();
  await mkdir(casDir, { recursive: true });
  const store = createFsStore(casDir);
  const schemas = await registerUwfSchemas(store);
  const varStore = createVariableStore(join(casDir, "variables.db"), store);
  await migrateWorkflowRegistryIfNeeded(storageRoot, varStore);
  await migrateThreadsIndexIfNeeded(storageRoot, varStore);
  await migrateHistoryIfNeeded(storageRoot, varStore);
  return { storageRoot, store, schemas, varStore };
}

async function loadWorkflowRegistryFromYaml(storageRoot: string): Promise<WorkflowRegistry> {
  const path = getRegistryPath(storageRoot);
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
}

/** One-time migration: `~/.uwf/workflows.yaml` → `@uwf/registry/*` variables. */
export async function migrateWorkflowRegistryIfNeeded(
  storageRoot: string,
  varStore: VariableStore,
): Promise<void> {
  const path = getRegistryPath(storageRoot);
  if (!existsSync(path)) {
    return;
  }

  const registry = await loadWorkflowRegistryFromYaml(storageRoot);
  for (const [name, hash] of Object.entries(registry)) {
    saveWorkflowRegistry(varStore, name, hash);
  }

  await rename(path, `${path}.migrated`);
}

export function loadWorkflowRegistry(varStore: VariableStore): WorkflowRegistry {
  const vars = varStore.list({ namePrefix: REGISTRY_VAR_PREFIX });
  const registry: WorkflowRegistry = {};
  for (const v of vars) {
    const name = v.name.slice(REGISTRY_VAR_PREFIX.length);
    registry[name] = v.value;
  }
  return registry;
}

export function saveWorkflowRegistry(varStore: VariableStore, name: string, hash: CasRef): void {
  varStore.set(`${REGISTRY_VAR_PREFIX}${name}`, hash);
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

async function loadThreadsIndexFromYaml(storageRoot: string): Promise<ThreadsIndex> {
  const path = getThreadsPath(storageRoot);
  try {
    const text = await readFile(path, "utf8");
    const raw = parse(text) as unknown;
    return parseThreadsIndex(raw);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return {};
    }
    throw e;
  }
}

/** One-time migration: `~/.uwf/threads.yaml` → `@uwf/thread/*` variables. */
export async function migrateThreadsIndexIfNeeded(
  storageRoot: string,
  varStore: VariableStore,
): Promise<void> {
  const path = getThreadsPath(storageRoot);
  if (!existsSync(path)) {
    return;
  }

  const index = await loadThreadsIndexFromYaml(storageRoot);
  for (const [threadId, entry] of Object.entries(index)) {
    setThread(varStore, threadId as ThreadId, entry);
  }

  await rename(path, `${path}.migrated`);
}

function threadVarName(threadId: ThreadId): string {
  return `${THREAD_VAR_PREFIX}${threadId}`;
}

function entryFromVariable(v: { value: string; tags: Record<string, string> }): ThreadIndexEntry {
  return {
    head: v.value as CasRef,
    suspendedRole: v.tags.suspendedRole ?? null,
    suspendMessage: v.tags.suspendMessage ?? null,
  };
}

/** Load all active threads (equivalent to legacy `loadThreadsIndex`). */
export function loadAllThreads(varStore: VariableStore): ThreadsIndex {
  const vars = varStore.list({ namePrefix: THREAD_VAR_PREFIX });
  const index: ThreadsIndex = {};
  for (const v of vars) {
    const threadId = v.name.slice(THREAD_VAR_PREFIX.length) as ThreadId;
    index[threadId] = entryFromVariable(v);
  }
  return index;
}

/** Get a single active thread entry, or null if not found. */
export function getThread(varStore: VariableStore, threadId: ThreadId): ThreadIndexEntry | null {
  const vars = varStore.list({ exactName: threadVarName(threadId) });
  const v = vars[0];
  if (v === undefined) {
    return null;
  }
  return entryFromVariable(v);
}

/** Set or update a single active thread entry. */
export function setThread(
  varStore: VariableStore,
  threadId: ThreadId,
  entry: ThreadIndexEntry,
): void {
  const name = threadVarName(threadId);
  // Head CAS nodes may use different schemas (StartNode vs StepNode) — clear all variants first.
  varStore.remove(name);
  const tags: Record<string, string> = {};
  if (entry.suspendedRole !== null) {
    tags.suspendedRole = entry.suspendedRole;
  }
  if (entry.suspendMessage !== null) {
    tags.suspendMessage = entry.suspendMessage;
  }
  varStore.set(name, entry.head, { tags });
}

/** Remove an active thread entry (on complete/cancel). */
export function deleteThread(varStore: VariableStore, threadId: ThreadId): void {
  varStore.remove(threadVarName(threadId));
}

function parseHistoryJsonlLine(trimmed: string): ThreadHistoryLine | null {
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
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
    return {
      thread: thread as ThreadId,
      workflow,
      head,
      completedAt,
      reason: parsedReason,
    };
  }
  return null;
}

/** One-time migration: `~/.uwf/history.jsonl` → `@uwf/history/*` variables. */
export async function migrateHistoryIfNeeded(
  storageRoot: string,
  varStore: VariableStore,
): Promise<void> {
  const path = join(storageRoot, "history.jsonl");
  if (!existsSync(path)) {
    return;
  }

  const text = await readFile(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    const entry = parseHistoryJsonlLine(trimmed);
    if (entry !== null) {
      addHistoryEntry(varStore, entry);
    }
  }

  await rename(path, `${path}.migrated`);
}

export function loadAllHistory(varStore: VariableStore): ThreadHistoryLine[] {
  const vars = varStore.list({ namePrefix: HISTORY_VAR_PREFIX });
  return vars.map((v) => ({
    thread: v.name.slice(HISTORY_VAR_PREFIX.length) as ThreadId,
    workflow: v.tags.workflow ?? "",
    head: v.value as CasRef,
    completedAt: Number(v.tags.completedAt ?? "0"),
    reason: v.tags.reason === "completed" || v.tags.reason === "cancelled" ? v.tags.reason : null,
  }));
}

export function findHistoryEntry(
  varStore: VariableStore,
  threadId: ThreadId,
): ThreadHistoryLine | null {
  const vars = varStore.list({ namePrefix: `${HISTORY_VAR_PREFIX}${threadId}` });
  const v = vars.find((entry) => entry.name === `${HISTORY_VAR_PREFIX}${threadId}`);
  if (v === undefined) {
    return null;
  }
  return {
    thread: threadId,
    workflow: v.tags.workflow ?? "",
    head: v.value as CasRef,
    completedAt: Number(v.tags.completedAt ?? "0"),
    reason: v.tags.reason === "completed" || v.tags.reason === "cancelled" ? v.tags.reason : null,
  };
}

export function addHistoryEntry(varStore: VariableStore, entry: ThreadHistoryLine): void {
  varStore.set(`${HISTORY_VAR_PREFIX}${entry.thread}`, entry.head, {
    tags: {
      workflow: entry.workflow,
      completedAt: String(entry.completedAt),
      reason: entry.reason ?? "completed",
    },
  });
}
