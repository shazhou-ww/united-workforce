import type { Store as CasStore, JSONSchema } from "@uncaged/json-cas";
import { getSchema } from "@uncaged/json-cas";
import type {
  CasRef,
  StartNodePayload,
  StepNodePayload,
  ThreadId,
} from "@uncaged/workflow-protocol";
import { findThreadInHistory, loadThreadsIndex, type UwfStore } from "../store.js";

type ChainState = {
  startHash: CasRef;
  start: StartNodePayload;
  stepsNewestFirst: StepNodePayload[];
  headIsStart: boolean;
};

type OrderedStepItem = {
  hash: CasRef;
  payload: StepNodePayload;
  timestamp: number;
};

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function walkChain(uwf: UwfStore, headHash: CasRef): ChainState {
  const headNode = uwf.store.get(headHash);
  if (headNode === null) {
    fail(`CAS node not found: ${headHash}`);
  }

  if (headNode.type === uwf.schemas.startNode) {
    return {
      startHash: headHash,
      start: headNode.payload as StartNodePayload,
      stepsNewestFirst: [],
      headIsStart: true,
    };
  }

  if (headNode.type !== uwf.schemas.stepNode) {
    fail(`head ${headHash} is not a StartNode or StepNode`);
  }

  const stepsNewestFirst: StepNodePayload[] = [];
  let hash: CasRef | null = headHash;

  while (hash !== null) {
    const node = uwf.store.get(hash);
    if (node === null) {
      fail(`CAS node not found while walking chain: ${hash}`);
    }
    if (node.type !== uwf.schemas.stepNode) {
      break;
    }
    const payload = node.payload as StepNodePayload;
    stepsNewestFirst.push(payload);
    hash = payload.prev;
  }

  const newest = stepsNewestFirst[0];
  if (newest === undefined) {
    fail(`empty step chain at head ${headHash}`);
  }

  const startNode = uwf.store.get(newest.start);
  if (startNode === null || startNode.type !== uwf.schemas.startNode) {
    fail(`StartNode not found: ${newest.start}`);
  }

  return {
    startHash: newest.start,
    start: startNode.payload as StartNodePayload,
    stepsNewestFirst,
    headIsStart: false,
  };
}

function expandOutput(uwf: UwfStore, outputRef: CasRef): unknown {
  const node = uwf.store.get(outputRef);
  if (node === null) {
    return {};
  }
  return node.payload;
}

/**
 * Recursively expand all cas_ref fields in a CAS node's payload,
 * replacing hash strings with the referenced node's expanded payload.
 */
function expandDeep(store: CasStore, hash: CasRef, visited?: Set<string>): unknown {
  const seen = visited ?? new Set<string>();
  if (seen.has(hash)) return hash; // cycle guard
  seen.add(hash);

  const node = store.get(hash);
  if (node === null) return hash;

  const schema = getSchema(store, node.type);
  if (schema === null) return node.payload;

  return expandValue(store, schema, node.payload, seen);
}

function expandCasRefField(store: CasStore, value: unknown, visited: Set<string>): unknown {
  if (typeof value === "string") {
    return expandDeep(store, value as CasRef, visited);
  }
  return value;
}

function expandAnyOfField(
  store: CasStore,
  schema: JSONSchema,
  value: unknown,
  visited: Set<string>,
): unknown {
  if (!Array.isArray(schema.anyOf)) return value;
  for (const sub of schema.anyOf as JSONSchema[]) {
    if (sub.format === "cas_ref" && typeof value === "string") {
      return expandDeep(store, value as CasRef, visited);
    }
  }
  return value;
}

function expandArrayField(
  store: CasStore,
  schema: JSONSchema,
  value: unknown,
  visited: Set<string>,
): unknown {
  if (!schema.items || !Array.isArray(value)) return value;
  const itemSchema = schema.items as JSONSchema;
  return (value as unknown[]).map((item) => expandValue(store, itemSchema, item, visited));
}

function expandObjectField(
  store: CasStore,
  schema: JSONSchema,
  value: unknown,
  visited: Set<string>,
): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value) || !schema.properties) {
    return value;
  }
  const props = schema.properties as Record<string, JSONSchema>;
  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const propSchema = props[key];
    result[key] = propSchema ? expandValue(store, propSchema, val, visited) : val;
  }
  return result;
}

function expandValue(
  store: CasStore,
  schema: JSONSchema,
  value: unknown,
  visited: Set<string>,
): unknown {
  if (schema.format === "cas_ref") return expandCasRefField(store, value, visited);
  if (Array.isArray(schema.anyOf)) return expandAnyOfField(store, schema, value, visited);
  if (schema.type === "array") return expandArrayField(store, schema, value, visited);
  return expandObjectField(store, schema, value, visited);
}

function collectOrderedSteps(
  uwf: UwfStore,
  headHash: CasRef,
  chain: ChainState,
): OrderedStepItem[] {
  let hash: CasRef | null = headHash;
  const hashToNode = new Map<string, { payload: StepNodePayload; timestamp: number }>();
  while (hash !== null) {
    const node = uwf.store.get(hash);
    if (node === null || node.type !== uwf.schemas.stepNode) {
      break;
    }
    const payload = node.payload as StepNodePayload;
    hashToNode.set(hash, { payload, timestamp: node.timestamp });
    hash = payload.prev;
  }

  let cur: CasRef | null = chain.headIsStart ? null : headHash;
  const ordered: OrderedStepItem[] = [];
  while (cur !== null) {
    const entry = hashToNode.get(cur);
    if (entry === undefined) {
      break;
    }
    ordered.push({ hash: cur, ...entry });
    cur = entry.payload.prev;
  }

  ordered.reverse();
  return ordered;
}

async function resolveHeadHash(storageRoot: string, threadId: ThreadId): Promise<CasRef> {
  const index = await loadThreadsIndex(storageRoot);
  const activeHead = index[threadId];
  if (activeHead !== undefined) {
    return activeHead;
  }
  const hist = await findThreadInHistory(storageRoot, threadId);
  if (hist !== null) {
    return hist.head;
  }
  fail(`thread not found: ${threadId}`);
}

export {
  type ChainState,
  collectOrderedSteps,
  expandAnyOfField,
  expandArrayField,
  expandCasRefField,
  expandDeep,
  expandObjectField,
  expandOutput,
  expandValue,
  fail,
  type OrderedStepItem,
  resolveHeadHash,
  walkChain,
};
