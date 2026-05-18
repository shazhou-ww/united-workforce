import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Hash, Store } from "@uncaged/json-cas";
import { createFsStore } from "@uncaged/json-cas-fs";
import type { CasRef } from "@uncaged/uwf-protocol";
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

export function resolveWorkflowHash(registry: WorkflowRegistry, id: string): CasRef | null {
  if (registry[id] !== undefined) {
    return registry[id];
  }
  return id;
}

export function findRegistryName(registry: WorkflowRegistry, hash: Hash): string | null {
  for (const [name, h] of Object.entries(registry)) {
    if (h === hash) {
      return name;
    }
  }
  return null;
}
