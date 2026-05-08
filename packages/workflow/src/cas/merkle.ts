import { parse, stringify } from "yaml";

import type { CasStore, MerkleNode, StepMerklePayload, ThreadMerklePayload } from "./types.js";

export function serializeMerkleNode(node: MerkleNode): string {
  return stringify(
    { type: node.type, payload: node.payload, children: node.children },
    { indent: 2 },
  );
}

export function parseMerkleNode(yamlText: string): MerkleNode {
  const raw = parse(yamlText) as unknown;
  if (raw === null || typeof raw !== "object") {
    throw new Error("merkle: YAML root must be an object");
  }
  const rec = raw as Record<string, unknown>;
  const type = rec.type;
  const payload = rec.payload;
  const children = rec.children;
  if (type !== "content" && type !== "step" && type !== "thread") {
    throw new Error("merkle: invalid or missing type");
  }
  if (typeof payload !== "string" && (payload === null || typeof payload !== "object")) {
    throw new Error("merkle: payload must be a string or object");
  }
  if (!Array.isArray(children)) {
    throw new Error("merkle: children must be an array");
  }
  const childHashes: string[] = [];
  for (const c of children) {
    if (typeof c !== "string") {
      throw new Error("merkle: child hash must be a string");
    }
    childHashes.push(c);
  }
  return {
    type,
    payload: typeof payload === "string" ? payload : (payload as Record<string, unknown>),
    children: childHashes,
  };
}

export function createContentMerkleNode(payload: string): MerkleNode {
  return { type: "content", payload, children: [] };
}

/** Serializes a step Merkle node (role + meta + content child) and stores it in CAS. */
export async function putStepMerkleNode(
  store: CasStore,
  payload: StepMerklePayload,
  contentHash: string,
): Promise<string> {
  const node: MerkleNode = {
    type: "step",
    payload: { role: payload.role, meta: payload.meta },
    children: [contentHash],
  };
  return store.put(serializeMerkleNode(node));
}

/** Serializes the thread root Merkle node and stores it in CAS. */
export async function putThreadMerkleNode(
  store: CasStore,
  payload: ThreadMerklePayload,
  stepHashes: readonly string[],
): Promise<string> {
  const node: MerkleNode = {
    type: "thread",
    payload: {
      workflow: payload.workflow,
      threadId: payload.threadId,
      result: payload.result,
    },
    children: [...stepHashes],
  };
  return store.put(serializeMerkleNode(node));
}

/** Serializes a content Merkle node and stores it in CAS; returns its hash. */
export async function putContentMerkleNode(store: CasStore, content: string): Promise<string> {
  const yamlText = serializeMerkleNode(createContentMerkleNode(content));
  return store.put(yamlText);
}

/** Loads a CAS blob and returns the payload string for a `content` Merkle node. */
export async function getContentMerklePayload(
  store: CasStore,
  hash: string,
): Promise<string | null> {
  const yamlText = await store.get(hash);
  if (yamlText === null) {
    return null;
  }
  const node = parseMerkleNode(yamlText);
  if (node.type !== "content" || typeof node.payload !== "string") {
    return null;
  }
  return node.payload;
}
