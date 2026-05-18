import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Hash, JSONSchema, Store } from "@uncaged/json-cas";
import { bootstrap, getSchema, refs, walk } from "@uncaged/json-cas";
import { createFsStore } from "@uncaged/json-cas-fs";

// ---- Helpers ----

function openStore(storageRoot: string): Store {
  return createFsStore(join(storageRoot, "cas"));
}

function out(data: unknown, compact = false): void {
  console.log(compact ? JSON.stringify(data) : JSON.stringify(data, null, 2));
}

function readJsonArg(fileOrInline: string): unknown {
  // Try as inline JSON first, then as file path
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

// ---- Commands ----

export async function cmdCasGet(
  storageRoot: string,
  hash: string,
  opts: { json?: boolean },
): Promise<void> {
  const store = openStore(storageRoot);
  const node = store.get(hash);
  if (node === null) {
    throw new Error(`Node not found: ${hash}`);
  }
  out(node, opts.json);
}

export async function cmdCasCat(
  storageRoot: string,
  hash: string,
  opts: { payload?: boolean; json?: boolean },
): Promise<void> {
  const store = openStore(storageRoot);
  const node = store.get(hash);
  if (node === null) {
    throw new Error(`Node not found: ${hash}`);
  }
  out(opts.payload ? node.payload : node, opts.json);
}

export async function cmdCasPut(
  storageRoot: string,
  typeHash: string,
  data: string,
  opts: { json?: boolean },
): Promise<void> {
  const store = openStore(storageRoot);
  const payload = readJsonArg(data);
  const hash = store.put(typeHash, payload);
  console.log(hash);
}

export async function cmdCasHas(
  storageRoot: string,
  hash: string,
): Promise<void> {
  const store = openStore(storageRoot);
  console.log(String(store.has(hash)));
}

export async function cmdCasList(storageRoot: string): Promise<void> {
  const store = openStore(storageRoot);
  for (const hash of store.list()) {
    console.log(hash);
  }
}

export async function cmdCasRefs(storageRoot: string, hash: string): Promise<void> {
  const store = openStore(storageRoot);
  const node = store.get(hash);
  if (node === null) {
    throw new Error(`Node not found: ${hash}`);
  }
  const refHashes = refs(store, node);
  for (const r of refHashes) {
    console.log(r);
  }
}

export async function cmdCasWalk(
  storageRoot: string,
  hash: string,
  opts: { format?: string },
): Promise<void> {
  const store = openStore(storageRoot);

  if (opts.format === "tree") {
    const childMap = new Map<Hash, Hash[]>();
    walk(store, hash, (h, node) => {
      childMap.set(h, refs(store, node));
    });

    const printed = new Set<Hash>();

    function printNode(h: Hash, prefix: string, isLast: boolean): void {
      const connector = prefix === "" ? "" : isLast ? "└── " : "├── ";
      if (printed.has(h)) {
        console.log(`${prefix}${connector}${h} (seen)`);
        return;
      }
      printed.add(h);
      console.log(`${prefix}${connector}${h}`);

      const kids = childMap.get(h) ?? [];
      const childPrefix = prefix === "" ? "" : prefix + (isLast ? "    " : "│   ");
      for (let i = 0; i < kids.length; i++) {
        printNode(kids[i] as Hash, childPrefix, i === kids.length - 1);
      }
    }

    printNode(hash, "", true);
  } else {
    walk(store, hash, (h) => {
      console.log(h);
    });
  }
}

export async function cmdCasSchemaList(storageRoot: string): Promise<void> {
  const store = openStore(storageRoot);
  const metaHash = await bootstrap(store);
  for (const hash of store.list()) {
    if (hash === metaHash) continue;
    const node = store.get(hash);
    if (node !== null && node.type === metaHash) {
      const schema = node.payload as JSONSchema;
      const name =
        (schema.title as string | undefined) ??
        (schema.description as string | undefined) ??
        "(unnamed)";
      console.log(`${hash}  ${name}`);
    }
  }
}

export async function cmdCasSchemaGet(
  storageRoot: string,
  hash: string,
  opts: { json?: boolean },
): Promise<void> {
  const store = openStore(storageRoot);
  const schema = getSchema(store, hash);
  if (schema === null) {
    throw new Error(`Schema not found: ${hash}`);
  }
  out(schema, opts.json);
}
