import { parse } from "yaml";

import type { CasStore } from "./types.js";

function refsFromBlob(content: string): string[] {
  try {
    const raw = parse(content) as unknown;
    if (raw === null || typeof raw !== "object") {
      return [];
    }
    const rec = raw as Record<string, unknown>;
    const refs = rec.refs;
    if (!Array.isArray(refs)) {
      return [];
    }
    const out: string[] = [];
    for (const r of refs) {
      if (typeof r === "string") {
        out.push(r);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Recursively collects all CAS hashes reachable from `roots` via each blob's `refs[]`. */
export async function findReachableHashes(
  roots: readonly string[],
  cas: CasStore,
): Promise<ReadonlySet<string>> {
  const visited = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const hash = stack.pop();
    if (hash === undefined) {
      break;
    }
    if (visited.has(hash)) {
      continue;
    }
    const blob = await cas.get(hash);
    if (blob === null) {
      continue;
    }
    visited.add(hash);
    for (const ref of refsFromBlob(blob)) {
      if (!visited.has(ref)) {
        stack.push(ref);
      }
    }
  }
  return visited;
}
