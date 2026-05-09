import type { ContentMerkleNode, StartNode, StateNode } from "@uncaged/workflow-protocol";
import { parse, stringify } from "yaml";

import { collectRefs } from "./collect-refs.js";
import type { CasStore } from "./types.js";

/** YAML-serialize a CAS node carrying `{type, payload, refs}` (RFC v3 thread storage format). */
export function serializeCasNode(node: StartNode | StateNode | ContentMerkleNode): string {
  return stringify({ type: node.type, payload: node.payload, refs: node.refs }, { indent: 2 });
}

/**
 * Recognizes a YAML CAS blob with the `{type, payload, refs[]}` shape used by
 * `start` / `state` / `content` thread nodes. Used by {@link createCasStore}
 * to skip the legacy auto-wrap step when the caller already supplied a
 * pre-serialized RFC v3 node.
 */
export function isCasNodeYaml(content: string): boolean {
  let raw: unknown;
  try {
    raw = parse(content) as unknown;
  } catch {
    return false;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return false;
  }
  const rec = raw as Record<string, unknown>;
  if (typeof rec.type !== "string") {
    return false;
  }
  if (!Array.isArray(rec.refs)) {
    return false;
  }
  for (const r of rec.refs) {
    if (typeof r !== "string") {
      return false;
    }
  }
  return true;
}

export async function putStartNode(
  store: CasStore,
  payload: StartNode["payload"],
  promptHash: string,
): Promise<string> {
  const node: StartNode = {
    type: "start",
    payload,
    refs: [promptHash],
  };
  return store.put(serializeCasNode(node));
}

export async function putStateNode(
  store: CasStore,
  payload: StateNode["payload"],
): Promise<string> {
  const node: StateNode = {
    type: "state",
    payload,
    refs: collectRefs(payload),
  };
  return store.put(serializeCasNode(node));
}

export async function putContentNodeWithRefs(
  store: CasStore,
  payload: string,
  refs: readonly string[],
): Promise<string> {
  const node: ContentMerkleNode = {
    type: "content",
    payload,
    refs: [...refs],
  };
  return store.put(serializeCasNode(node));
}
