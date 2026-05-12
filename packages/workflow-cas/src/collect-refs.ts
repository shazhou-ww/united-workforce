import type { StateNode } from "@uncaged/workflow-protocol";

/** Collects CAS hashes from {@link StateNode} payload fields for GC `refs[]` derivation. */
export function collectRefs(payload: StateNode["payload"]): string[] {
  const out: string[] = [payload.start, payload.content];
  for (const h of payload.ancestors) {
    out.push(h);
  }
  if (payload.compact !== null) {
    out.push(payload.compact);
  }
  if (payload.childThread !== null) {
    out.push(payload.childThread);
  }
  return out;
}
