import { parse, stringify } from "yaml";

import type {
  CasStore,
  MerkleNode,
  MerkleNodeType,
  StepMerklePayload,
  ThreadMerklePayload,
} from "./types.js";

function requireStringHashArray(value: unknown, notArrayMessage: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(notArrayMessage);
  }
  const out: string[] = [];
  for (const c of value) {
    if (typeof c !== "string") {
      throw new Error("merkle: hash entry must be a string");
    }
    out.push(c);
  }
  return out;
}

function edgeListRaw(rec: Record<string, unknown>, type: MerkleNodeType): unknown {
  if (type === "content") {
    return rec.refs !== undefined ? rec.refs : rec.children;
  }
  return rec.children;
}

export function serializeMerkleNode(node: MerkleNode): string {
  if (node.type === "content") {
    return stringify(
      { type: node.type, payload: node.payload, refs: node.children },
      { indent: 2 },
    );
  }
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
  if (type !== "content" && type !== "step" && type !== "thread") {
    throw new Error("merkle: invalid or missing type");
  }
  if (typeof payload !== "string" && (payload === null || typeof payload !== "object")) {
    throw new Error("merkle: payload must be a string or object");
  }

  const notArrayMsg =
    type === "content"
      ? "merkle: content node requires refs or children array"
      : "merkle: children must be an array";
  const childHashes = requireStringHashArray(edgeListRaw(rec, type), notArrayMsg);
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

/** Stores agent/content text via CAS; {@link createCasStore} wraps raw strings as merkle content nodes. */
export async function putContentMerkleNode(store: CasStore, content: string): Promise<string> {
  return store.put(content);
}

/**
 * Loads a CAS blob and returns the payload string for a `content` node.
 *
 * Accepts both the legacy `{ type:content, payload, children }` Merkle layout
 * and the RFC-aligned `{ type:content, payload, refs }` content node layout.
 */
export async function getContentMerklePayload(
  store: CasStore,
  hash: string,
): Promise<string | null> {
  const yamlText = await store.get(hash);
  if (yamlText === null) {
    return null;
  }
  const raw = parse(yamlText) as unknown;
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const rec = raw as Record<string, unknown>;
  if (rec.type !== "content" || typeof rec.payload !== "string") {
    return null;
  }
  return rec.payload;
}
