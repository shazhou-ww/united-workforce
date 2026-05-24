import type { Store as CasStore, JSONSchema } from "@uncaged/json-cas";
import { getSchema } from "@uncaged/json-cas";
import type {
  CasRef,
  StartEntry,
  StartNodePayload,
  StepEntry,
  StepNodePayload,
  ThreadForkOutput,
  ThreadId,
  ThreadStepsOutput,
} from "@uncaged/workflow-protocol";
import { generateUlid } from "@uncaged/workflow-util";
import { createUwfStore, loadThreadsIndex, saveThreadsIndex, type UwfStore } from "../store.js";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

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
  if (!Array.isArray(value)) return value;
  const itemSchema = schema.items as JSONSchema | undefined;
  if (itemSchema === undefined) return value;
  return value.map((item) => expandValue(store, itemSchema, item, visited));
}

function expandObjectField(
  store: CasStore,
  schema: JSONSchema,
  value: unknown,
  visited: Set<string>,
): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const props = schema.properties as Record<string, JSONSchema> | undefined;
  if (props === undefined) return value;
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    const propSchema = props[key];
    result[key] = propSchema !== undefined ? expandValue(store, propSchema, val, visited) : val;
  }
  return result;
}

function expandValue(
  store: CasStore,
  schema: JSONSchema,
  value: unknown,
  visited: Set<string>,
): unknown {
  if (schema.format === "cas_ref") {
    return expandCasRefField(store, value, visited);
  }
  if (schema.anyOf !== undefined) {
    return expandAnyOfField(store, schema, value, visited);
  }
  if (schema.type === "array") {
    return expandArrayField(store, schema, value, visited);
  }
  if (schema.type === "object") {
    return expandObjectField(store, schema, value, visited);
  }
  return value;
}

function collectOrderedSteps(
  uwf: UwfStore,
  headHash: CasRef,
  chain: ChainState,
): OrderedStepItem[] {
  const reversed = chain.stepsNewestFirst.slice().reverse();
  const ordered: OrderedStepItem[] = [];

  let hash: CasRef | null = chain.headIsStart ? null : headHash;
  for (const payload of reversed) {
    if (hash === null) {
      fail("unexpected null hash while collecting ordered steps");
    }
    const node = uwf.store.get(hash);
    if (node === null) {
      fail(`CAS node not found: ${hash}`);
    }
    ordered.push({
      hash,
      payload,
      timestamp: node.timestamp,
    });
    hash = payload.prev;
  }

  return ordered;
}

async function resolveHeadHash(storageRoot: string, threadId: ThreadId): Promise<CasRef> {
  const index = await loadThreadsIndex(storageRoot);
  const head = index[threadId];
  if (head === undefined) {
    fail(`thread not active: ${threadId}`);
  }
  return head;
}

/**
 * List all steps in a thread (previously: thread steps)
 */
export async function cmdStepList(
  storageRoot: string,
  threadId: ThreadId,
): Promise<ThreadStepsOutput> {
  const headHash = await resolveHeadHash(storageRoot, threadId);
  const uwf = await createUwfStore(storageRoot);
  const chain = walkChain(uwf, headHash);

  const startNode = uwf.store.get(chain.startHash);
  if (startNode === null) {
    fail(`StartNode not found: ${chain.startHash}`);
  }

  const startEntry: StartEntry = {
    hash: chain.startHash,
    workflow: chain.start.workflow,
    prompt: chain.start.prompt,
    timestamp: startNode.timestamp,
  };

  const stepEntries: StepEntry[] = [];
  const ordered = collectOrderedSteps(uwf, headHash, chain);

  for (const item of ordered) {
    stepEntries.push({
      hash: item.hash,
      role: item.payload.role,
      output: expandOutput(uwf, item.payload.output),
      detail: item.payload.detail,
      agent: item.payload.agent,
      timestamp: item.timestamp,
    });
  }

  return {
    thread: threadId,
    workflow: chain.start.workflow,
    steps: [startEntry, ...stepEntries],
  };
}

/**
 * Show details of a specific step (previously: thread step-details)
 */
export async function cmdStepShow(storageRoot: string, stepHash: CasRef): Promise<unknown> {
  const uwf = await createUwfStore(storageRoot);
  const node = uwf.store.get(stepHash);
  if (node === null) {
    fail(`CAS node not found: ${stepHash}`);
  }
  if (node.type !== uwf.schemas.stepNode) {
    fail(`node ${stepHash} is not a StepNode`);
  }
  const payload = node.payload as StepNodePayload;
  if (!payload.detail) {
    fail(`step ${stepHash} has no detail`);
  }
  return expandDeep(uwf.store, payload.detail);
}

/**
 * Fork a thread from a specific step (previously: thread fork)
 */
export async function cmdStepFork(
  storageRoot: string,
  stepHash: CasRef,
): Promise<ThreadForkOutput> {
  const uwf = await createUwfStore(storageRoot);
  const node = uwf.store.get(stepHash);
  if (node === null) {
    fail(`CAS node not found: ${stepHash}`);
  }
  if (node.type !== uwf.schemas.startNode && node.type !== uwf.schemas.stepNode) {
    fail(`node ${stepHash} is not a StartNode or StepNode`);
  }

  const newThreadId = generateUlid(Date.now()) as ThreadId;
  const index = await loadThreadsIndex(storageRoot);
  index[newThreadId] = stepHash;
  await saveThreadsIndex(storageRoot, index);

  return {
    thread: newThreadId,
    forkedFrom: {
      step: stepHash,
    },
  };
}

/**
 * Read a step's agent output as markdown (new command - requires #462)
 * TODO: Implement once unified agent detail/turn schema is available
 */
export async function cmdStepRead(
  storageRoot: string,
  stepHash: CasRef,
  before: number | null = null,
): Promise<string> {
  const uwf = await createUwfStore(storageRoot);
  const node = uwf.store.get(stepHash);
  if (node === null) {
    fail(`CAS node not found: ${stepHash}`);
  }
  if (node.type !== uwf.schemas.stepNode) {
    fail(`node ${stepHash} is not a StepNode`);
  }
  const payload = node.payload as StepNodePayload;
  if (!payload.output) {
    fail(`step ${stepHash} has no output`);
  }

  // TODO: Implement progressive turn reading with --before N
  // For now, return a placeholder
  const outputNode = uwf.store.get(payload.output);
  if (outputNode === null) {
    fail(`output node not found: ${payload.output}`);
  }

  // Return the output as JSON for now
  // Once #462 is implemented, this will properly format frontmatter + markdown
  return JSON.stringify(outputNode.payload, null, 2);
}
