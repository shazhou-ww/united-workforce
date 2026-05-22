import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { JSONSchema, Store } from "@uncaged/json-cas";
import { bootstrap, getSchema, refs, walk } from "@uncaged/json-cas";
import { createFsStore } from "@uncaged/json-cas-fs";

// ---- Helpers ----

function openStore(storageRoot: string): Store {
  return createFsStore(join(storageRoot, "cas"));
}

function readJsonArg(fileOrInline: string): unknown {
  try {
    return JSON.parse(fileOrInline);
  } catch {
    try {
      return JSON.parse(readFileSync(fileOrInline, "utf-8"));
    } catch (e) {
      throw new Error(`Cannot parse JSON from "${fileOrInline}": ${e}`);
    }
  }
}

// ---- Commands (all return JSON-serializable data) ----

export async function cmdCasGet(
  storageRoot: string,
  hash: string,
  opts: { timestamp?: boolean },
): Promise<unknown> {
  const store = openStore(storageRoot);
  const node = store.get(hash);
  if (node === null) {
    throw new Error(`Node not found: ${hash}`);
  }
  if (opts.timestamp) {
    return node;
  }
  const { timestamp: _, ...rest } = node as Record<string, unknown>;
  return rest;
}

export async function cmdCasPut(
  storageRoot: string,
  typeHash: string,
  data: string,
): Promise<{ hash: string }> {
  const store = openStore(storageRoot);
  const payload = readJsonArg(data);
  const hash = await store.put(typeHash, payload);
  return { hash };
}

export async function cmdCasHas(storageRoot: string, hash: string): Promise<{ exists: boolean }> {
  const store = openStore(storageRoot);
  return { exists: store.has(hash) };
}

export async function cmdCasRefs(storageRoot: string, hash: string): Promise<{ refs: string[] }> {
  const store = openStore(storageRoot);
  const node = store.get(hash);
  if (node === null) {
    throw new Error(`Node not found: ${hash}`);
  }
  return { refs: refs(store, node) };
}

export async function cmdCasWalk(storageRoot: string, hash: string): Promise<{ hashes: string[] }> {
  const store = openStore(storageRoot);
  const result: string[] = [];
  walk(store, hash, (h) => {
    result.push(h);
  });
  return { hashes: result };
}

export type SchemaListEntry = {
  hash: string;
  title: string;
};

export async function cmdCasSchemaList(storageRoot: string): Promise<SchemaListEntry[]> {
  const store = openStore(storageRoot);
  const metaHash = await bootstrap(store);
  const entries: SchemaListEntry[] = [];

  // Include meta-schema itself
  entries.push({ hash: metaHash, title: "(meta-schema)" });

  for (const hash of store.listByType(metaHash)) {
    if (hash === metaHash) continue;
    const node = store.get(hash);
    if (node !== null) {
      const schema = node.payload as JSONSchema;
      const title =
        (schema.title as string | undefined) ??
        (schema.description as string | undefined) ??
        "(unnamed)";
      entries.push({ hash, title });
    }
  }
  return entries;
}

export async function cmdCasReindex(storageRoot: string): Promise<{ status: string }> {
  const indexDir = join(storageRoot, "cas", "_index");
  const { rmSync } = await import("node:fs");
  rmSync(indexDir, { recursive: true, force: true });
  // Re-open store to trigger migration rebuild
  openStore(storageRoot);
  return { status: "reindexed" };
}

export async function cmdCasSchemaGet(storageRoot: string, hash: string): Promise<unknown> {
  const store = openStore(storageRoot);
  const schema = getSchema(store, hash);
  if (schema === null) {
    throw new Error(`Schema not found: ${hash}`);
  }
  return schema;
}
