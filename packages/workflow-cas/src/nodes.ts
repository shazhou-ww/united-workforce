import type {
  ContentMerkleNode,
  StartNode,
  StartNodePayload,
  StateNode,
  StateNodePayload,
} from "@uncaged/workflow-protocol";
import { parse, stringify } from "yaml";

import { collectRefs } from "./collect-refs.js";
import type { CasStore } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStartPayload(value: unknown): value is StartNodePayload {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.name === "string" &&
    typeof value.hash === "string" &&
    typeof value.maxRounds === "number" &&
    typeof value.depth === "number"
  );
}

function isStatePayload(value: unknown): value is StateNodePayload {
  if (!isRecord(value)) {
    return false;
  }
  const compact = value.compact;
  if (!(compact === null || typeof compact === "string")) {
    return false;
  }
  const ancestors = value.ancestors;
  if (!Array.isArray(ancestors) || !ancestors.every((h) => typeof h === "string")) {
    return false;
  }
  const meta = value.meta;
  if (!isRecord(meta)) {
    return false;
  }
  return (
    typeof value.role === "string" &&
    typeof value.start === "string" &&
    typeof value.content === "string" &&
    typeof value.timestamp === "number"
  );
}

/** Parses a YAML CAS blob into a typed RFC v3 thread node (or legacy content layout with `children`). */
export function parseCasThreadNode(yamlText: string): ParsedCasThreadNode | null {
  let raw: unknown;
  try {
    raw = parse(yamlText) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(raw)) {
    return null;
  }
  const type = raw.type;
  if (type !== "start" && type !== "state" && type !== "content") {
    return null;
  }

  let refsRaw: unknown = raw.refs;
  if (refsRaw === undefined && type === "content") {
    refsRaw = raw.children;
  }
  if (!Array.isArray(refsRaw) || !refsRaw.every((r) => typeof r === "string")) {
    return null;
  }
  const refs = refsRaw as string[];

  if (type === "content") {
    if (typeof raw.payload !== "string") {
      return null;
    }
    const node: ContentMerkleNode = { type: "content", payload: raw.payload, refs: [...refs] };
    return { kind: "content", node };
  }

  if (type === "start") {
    if (!isStartPayload(raw.payload)) {
      return null;
    }
    const node: StartNode = { type: "start", payload: raw.payload, refs: [...refs] };
    return { kind: "start", node };
  }

  if (!isStatePayload(raw.payload)) {
    return null;
  }
  const node: StateNode = { type: "state", payload: raw.payload, refs: [...refs] };
  return { kind: "state", node };
}

export type ParsedCasThreadNode =
  | { kind: "start"; node: StartNode }
  | { kind: "state"; node: StateNode }
  | { kind: "content"; node: ContentMerkleNode };

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
