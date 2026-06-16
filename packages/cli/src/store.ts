import type { Dirent } from "node:fs";
import { existsSync } from "node:fs";
import { access, mkdir, readdir, readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";

import { bootstrap, type Hash, putSchema, type Store, type VarStore } from "@ocas/core";
import { createFsStore, createSqliteVarStore } from "@ocas/fs";
import type { CasRef, ThreadId, ThreadIndexEntry, ThreadsIndex } from "@united-workforce/protocol";
import { parseThreadsIndex } from "@united-workforce/protocol";
import { parse } from "yaml";

import { registerUwfSchemas, type UwfSchemaHashes } from "./schemas.js";

export type WorkflowRegistry = Record<string, CasRef>;

/** Variable name prefix for workflow registry entries (`@uwf/registry/<name>`). */
export const REGISTRY_VAR_PREFIX = "@uwf/registry/";

/** Variable name prefix for active thread entries (`@uwf/thread/<thread-id>`). */
export const THREAD_VAR_PREFIX = "@uwf/thread/";

/**
 * Variable name prefix for the in-flight turn list of a running step
 * (`@uwf/active-turns/<thread-id>/<role>`). Phase 2 of the realtime-turns RFC
 * (#398): broker-step appends each assistant turn hash here as it arrives, so
 * an independent process can observe a step's progress mid-flight. The var is a
 * mutable head pointer at an immutable CAS array node; it is cleared at the
 * start of each step and deleted once the turns are solidified into the
 * step's immutable `detail.turns`.
 */
export const ACTIVE_TURNS_VAR_PREFIX = "@uwf/active-turns/";

/**
 * Schema for the active-turns list node: a bare ordered array of turn-hash
 * `ocas_ref`s. Because an ocas variable is keyed by `(name, schema)` where the
 * schema is the pointed-at node's `type`, this schema must be stable so that
 * re-pointing the var (append), removing it (clear/solidify), and listing it by
 * exact name all address the same variable. The hash is content-addressed and
 * therefore identical across processes.
 */
export const ACTIVE_TURNS_LIST_SCHEMA = {
  title: "uwf-active-turns",
  type: "array" as const,
  items: { type: "string" as const, format: "ocas_ref" },
};

/** Build the active-turns variable name for a `(threadId, role)` pair. */
export function activeTurnsVarName(threadId: ThreadId, role: string): string {
  return `${ACTIVE_TURNS_VAR_PREFIX}${threadId}/${role}`;
}

/**
 * Register (idempotently) and return the CAS schema hash for the active-turns
 * list node. Used both as the array node's type and — implicitly — as the
 * variable's schema key.
 */
export function activeTurnsListSchemaHash(store: Store): Hash {
  return putSchema(store, ACTIVE_TURNS_LIST_SCHEMA);
}

/**
 * Read the ordered turn-hash list currently pointed at by
 * `@uwf/active-turns/<threadId>/<role>`. Returns `[]` when the var does not
 * exist (no turns appended yet, or already solidified/cleared).
 */
export function readActiveTurns(store: Store, threadId: ThreadId, role: string): CasRef[] {
  const name = activeTurnsVarName(threadId, role);
  const vars = store.var.list({ exactName: name });
  const v = vars[0];
  if (v === undefined) {
    return [];
  }
  const node = store.cas.get(v.value as CasRef);
  if (node === null || !Array.isArray(node.payload)) {
    return [];
  }
  return node.payload as CasRef[];
}

/**
 * Append a turn hash to `@uwf/active-turns/<threadId>/<role>` (read-modify-write
 * on the array node, then re-point the var). The var is a single mutable
 * pointer re-pointed on each append — not one var per turn. Returns the full
 * updated list.
 */
export function appendActiveTurn(
  store: Store,
  threadId: ThreadId,
  role: string,
  turnHash: CasRef,
): CasRef[] {
  const name = activeTurnsVarName(threadId, role);
  const current = readActiveTurns(store, threadId, role);
  const next = [...current, turnHash];
  const schemaHash = activeTurnsListSchemaHash(store);
  const listHash = store.cas.put(schemaHash, next) as CasRef;
  store.var.set(name, listHash);
  return next;
}

/**
 * Clear (delete) the `@uwf/active-turns/<threadId>/<role>` pointer. Removing a
 * missing var is a no-op, so this is safe to call at the start of a clean run.
 * Targets the exact `(threadId, role)` var only — concurrent active vars for
 * other roles/threads are untouched.
 */
export function clearActiveTurns(store: Store, threadId: ThreadId, role: string): void {
  const name = activeTurnsVarName(threadId, role);
  store.var.remove(name);
}

/** A workflow entry discovered from the project-local .workflows/ (primary) or .workflow/ (legacy) directory. */
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
export async function scanWorkflowDir(dir: string): Promise<ProjectWorkflowEntry[]> {
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

/** Merge primary (.workflows/) and legacy (.workflow/) entries, primary wins on name collision. */
function mergeWorkflowEntries(
  primary: ProjectWorkflowEntry[],
  legacy: ProjectWorkflowEntry[],
): ProjectWorkflowEntry[] {
  const seen = new Set(primary.map((e) => e.name));
  const merged = [...primary];
  for (const entry of legacy) {
    if (!seen.has(entry.name)) {
      merged.push(entry);
    }
  }
  return merged;
}

/** Check if a directory contains a .git marker (directory or file). */
async function hasGitMarker(dir: string): Promise<boolean> {
  try {
    await access(join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Discover project-local workflows by walking from `startDir` up through parent
 * directories. The nearest directory that contains a `.workflows/` or `.workflow/`
 * directory wins — once a match is found, traversal stops (entries from more
 * distant ancestors are NOT merged in).
 *
 * Within the winning directory:
 * - `.workflows/` (preferred/primary) takes priority over `.workflow/` (legacy fallback).
 * - If both exist in that directory, `.workflows/` entries win when names collide.
 *
 * This matches the resolution strategy of `findWorkflowInParents` used by
 * `uwf thread start`, so `uwf workflow list` and `uwf thread start` agree on
 * what's discoverable from any given subdirectory.
 *
 * Traversal stops at the first `.git` boundary (directory or file) or the
 * filesystem root. Returns an empty array if no `.workflows/` or `.workflow/`
 * directory exists within that range.
 */
export async function discoverProjectWorkflows(startDir: string): Promise<ProjectWorkflowEntry[]> {
  let currentDir = resolvePath(startDir);
  const root = resolvePath("/");

  while (true) {
    const primary = await scanWorkflowDir(join(currentDir, ".workflows"));
    const legacy = await scanWorkflowDir(join(currentDir, ".workflow"));

    if (primary.length > 0 || legacy.length > 0) {
      return mergeWorkflowEntries(primary, legacy);
    }

    // Stop at .git boundary (repo root)
    if (await hasGitMarker(currentDir)) {
      return [];
    }

    // Stop at filesystem root
    if (currentDir === root) {
      return [];
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return [];
    }
    currentDir = parentDir;
  }
}

/** Default filesystem root for uwf data (`~/.uwf`). */
export function getDefaultStorageRoot(): string {
  return join(homedir(), ".uwf");
}

/**
 * Discover workflows from workflowPaths directories.
 * Each directory is scanned directly for YAML files (like scanWorkflowDir).
 * Earlier dirs in the list take priority on name collisions.
 */
export async function discoverWorkflowPathsEntries(
  dirs: ReadonlyArray<string>,
): Promise<ProjectWorkflowEntry[]> {
  const seen = new Set<string>();
  const result: ProjectWorkflowEntry[] = [];

  for (const dir of dirs) {
    const entries = await scanWorkflowDir(dir);
    for (const entry of entries) {
      if (!seen.has(entry.name)) {
        seen.add(entry.name);
        result.push(entry);
      }
    }
  }

  return result;
}

/**
 * Resolve storage root.
 * Priority: `UWF_HOME` → default.
 */
export function resolveStorageRoot(): string {
  const primary = process.env.UWF_HOME;
  if (primary !== undefined && primary !== "") {
    return primary;
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
 * Returns the global CAS directory shared by all uwf and ocas tools.
 * Priority: `OCAS_HOME` → default ~/.ocas
 */
export function getGlobalCasDir(): string {
  const primary = process.env.OCAS_HOME;
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

export type UwfStore = {
  storageRoot: string;
  store: Store;
  schemas: UwfSchemaHashes;
  varStore: VarStore;
};

export async function createUwfStore(storageRoot: string): Promise<UwfStore> {
  const casDir = getGlobalCasDir();
  await mkdir(casDir, { recursive: true });
  const cas = createFsStore(casDir);
  const { var: varStore, tag } = createSqliteVarStore(join(casDir, "vars"), cas);
  const store: Store = { cas, var: varStore, tag };
  bootstrap(store);
  const schemas = await registerUwfSchemas(store);
  await migrateWorkflowRegistryIfNeeded(storageRoot, varStore);
  await migrateThreadsIndexIfNeeded(storageRoot, varStore);
  await migrateHistoryIfNeeded(storageRoot, varStore);
  migrateHistoryVarsToThreadVars(varStore);
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
  varStore: VarStore,
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

export function loadWorkflowRegistry(varStore: VarStore): WorkflowRegistry {
  const vars = varStore.list({ namePrefix: REGISTRY_VAR_PREFIX });
  const registry: WorkflowRegistry = {};
  for (const v of vars) {
    const name = v.name.slice(REGISTRY_VAR_PREFIX.length);
    registry[name] = v.value;
  }
  return registry;
}

export function saveWorkflowRegistry(varStore: VarStore, name: string, hash: CasRef): void {
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
  varStore: VarStore,
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
    status: (v.tags.status ?? "idle") as ThreadIndexEntry["status"],
    suspendedRole: v.tags.suspendedRole ?? null,
    suspendMessage: v.tags.suspendMessage ?? null,
    completedAt: v.tags.completedAt !== undefined ? Number(v.tags.completedAt) : null,
  };
}

/** Load all active threads (equivalent to legacy `loadThreadsIndex`). */
export function loadAllThreads(varStore: VarStore): ThreadsIndex {
  const vars = varStore.list({ namePrefix: THREAD_VAR_PREFIX });
  const index: ThreadsIndex = {};
  for (const v of vars) {
    const threadId = v.name.slice(THREAD_VAR_PREFIX.length) as ThreadId;
    index[threadId] = entryFromVariable(v);
  }
  return index;
}

/** Get a single active thread entry, or null if not found. */
export function getThread(varStore: VarStore, threadId: ThreadId): ThreadIndexEntry | null {
  const vars = varStore.list({ exactName: threadVarName(threadId) });
  const v = vars[0];
  if (v === undefined) {
    return null;
  }
  return entryFromVariable(v);
}

/** Set or update a single active thread entry. */
export function setThread(varStore: VarStore, threadId: ThreadId, entry: ThreadIndexEntry): void {
  const name = threadVarName(threadId);
  // Head CAS nodes may use different schemas (StartNode vs StepNode) — clear all variants first.
  varStore.remove(name);
  const tags: Record<string, string> = {};
  if (entry.status !== "idle") {
    tags.status = entry.status;
  }
  if (entry.suspendedRole !== null) {
    tags.suspendedRole = entry.suspendedRole;
  }
  if (entry.suspendMessage !== null) {
    tags.suspendMessage = entry.suspendMessage;
  }
  if (entry.completedAt !== null) {
    tags.completedAt = String(entry.completedAt);
  }
  varStore.set(name, entry.head, { tags });
}

/** Load only active threads (status not in end/cancelled). */
export function loadActiveThreads(varStore: VarStore): ThreadsIndex {
  const all = loadAllThreads(varStore);
  const active: ThreadsIndex = {};
  for (const [threadId, entry] of Object.entries(all)) {
    if (entry.status !== "end" && entry.status !== "cancelled") {
      active[threadId as ThreadId] = entry;
    }
  }
  return active;
}

/** Load only end/cancelled threads (history). */
export function loadHistoryThreads(varStore: VarStore): ThreadsIndex {
  const all = loadAllThreads(varStore);
  const history: ThreadsIndex = {};
  for (const [threadId, entry] of Object.entries(all)) {
    if (entry.status === "end" || entry.status === "cancelled") {
      history[threadId as ThreadId] = entry;
    }
  }
  return history;
}

/** Complete a thread by marking it end or cancelled. */
export function completeThread(
  varStore: VarStore,
  threadId: ThreadId,
  reason: "end" | "cancelled",
): void {
  const entry = getThread(varStore, threadId);
  if (entry === null) {
    return;
  }
  const completed = {
    head: entry.head,
    status: reason,
    suspendedRole: null,
    suspendMessage: null,
    completedAt: Date.now(),
  } as ThreadIndexEntry;
  setThread(varStore, threadId, completed);
  clearThreadFailedAttempts(varStore, threadId);
}

/**
 * Remove all `@uwf/thread-failed/<threadId>/*` variables for a thread.
 * Called on thread completion / cancellation so retry-lineage state does not
 * leak into the variable store after the thread is archived.
 */
export function clearThreadFailedAttempts(varStore: VarStore, threadId: ThreadId): void {
  const prefix = `@uwf/thread-failed/${threadId}/`;
  const vars = varStore.list({ namePrefix: prefix });
  for (const v of vars) {
    varStore.remove(v.name);
  }
}

type LegacyHistoryEntry = {
  thread: ThreadId;
  workflow: CasRef;
  head: CasRef;
  completedAt: number;
  reason: "completed" | "cancelled" | null;
};

function parseLegacyHistoryJsonlLine(trimmed: string): LegacyHistoryEntry | null {
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

/** One-time migration: `~/.uwf/history.jsonl` → `@uwf/thread/*` variables with status tags. */
export async function migrateHistoryIfNeeded(
  storageRoot: string,
  varStore: VarStore,
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
    const entry = parseLegacyHistoryJsonlLine(trimmed);
    if (entry !== null) {
      const status = entry.reason === "cancelled" ? "cancelled" : "end";
      const threadEntry: ThreadIndexEntry = {
        head: entry.head,
        status: status as ThreadIndexEntry["status"],
        suspendedRole: null,
        suspendMessage: null,
        completedAt: entry.completedAt,
      };
      setThread(varStore, entry.thread, threadEntry);
    }
  }

  await rename(path, `${path}.migrated`);
}

/** Migrate `@uwf/history/*` variables to `@uwf/thread/*` with status tags. */
export function migrateHistoryVarsToThreadVars(varStore: VarStore): void {
  const LEGACY_HISTORY_VAR_PREFIX = "@uwf/history/";
  const vars = varStore.list({ namePrefix: LEGACY_HISTORY_VAR_PREFIX });

  for (const v of vars) {
    const threadId = v.name.slice(LEGACY_HISTORY_VAR_PREFIX.length) as ThreadId;
    const reason = v.tags.reason;
    const status = reason === "cancelled" ? "cancelled" : "end";
    const completedAt = Number(v.tags.completedAt ?? Date.now());

    const threadEntry: ThreadIndexEntry = {
      head: v.value as CasRef,
      status: status as ThreadIndexEntry["status"],
      suspendedRole: null,
      suspendMessage: null,
      completedAt,
    };

    setThread(varStore, threadId, threadEntry);
    varStore.remove(v.name);
  }
}
