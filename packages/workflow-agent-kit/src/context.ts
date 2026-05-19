import type { Store } from "@uncaged/json-cas";
import type {
  CasRef,
  StartNodePayload,
  StepContext,
  StepNodePayload,
  ThreadId,
} from "@uncaged/workflow-protocol";
import { createAgentStore, loadThreadsIndex, resolveStorageRoot } from "./storage.js";
import type { AgentStore } from "./storage.js";
import type { AgentContext } from "./types.js";

type ChainState = {
  startHash: CasRef;
  start: StartNodePayload;
  stepsNewestFirst: StepNodePayload[];
  headIsStart: boolean;
};

function fail(message: string): never {
  throw new Error(message);
}

function walkChain(
  store: Store,
  schemas: AgentStore["schemas"],
  headHash: CasRef,
): ChainState {
  const headNode = store.get(headHash);
  if (headNode === null) {
    fail(`CAS node not found: ${headHash}`);
  }

  if (headNode.type === schemas.startNode) {
    return {
      startHash: headHash,
      start: headNode.payload as StartNodePayload,
      stepsNewestFirst: [],
      headIsStart: true,
    };
  }

  if (headNode.type !== schemas.stepNode) {
    fail(`head ${headHash} is not a StartNode or StepNode`);
  }

  const stepsNewestFirst: StepNodePayload[] = [];
  let hash: CasRef | null = headHash;

  while (hash !== null) {
    const node = store.get(hash);
    if (node === null) {
      fail(`CAS node not found while walking chain: ${hash}`);
    }
    if (node.type !== schemas.stepNode) {
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

  const startNode = store.get(newest.start);
  if (startNode === null || startNode.type !== schemas.startNode) {
    fail(`StartNode not found: ${newest.start}`);
  }

  return {
    startHash: newest.start,
    start: startNode.payload as StartNodePayload,
    stepsNewestFirst,
    headIsStart: false,
  };
}

function expandOutput(
  store: Store,
  outputRef: CasRef,
): unknown {
  const node = store.get(outputRef);
  if (node === null) {
    return {};
  }
  return node.payload;
}

async function buildHistory(
  store: Store,
  stepsNewestFirst: StepNodePayload[],
): Promise<StepContext[]> {
  const chronological = [...stepsNewestFirst].reverse();
  const history: StepContext[] = [];
  for (const step of chronological) {
    history.push({
      role: step.role,
      output: expandOutput(store, step.output),
      detail: step.detail,
      agent: step.agent,
    });
  }
  return history;
}

async function loadWorkflow(
  store: Store,
  schemas: AgentStore["schemas"],
  workflowRef: CasRef,
) {
  const node = store.get(workflowRef);
  if (node === null) {
    fail(`workflow CAS node not found: ${workflowRef}`);
  }
  if (node.type !== schemas.workflow) {
    fail(`node ${workflowRef} is not a Workflow`);
  }
  return node.payload as AgentContext["workflow"];
}

/**
 * Build agent execution context from thread head in threads.yaml.
 * Walks the CAS chain from head to StartNode and expands step outputs.
 */
export async function buildContext(threadId: ThreadId, role: string): Promise<AgentContext> {
  const storageRoot = resolveStorageRoot();
  const agentStore = await createAgentStore(storageRoot);
  const { store, schemas } = agentStore;

  const index = await loadThreadsIndex(storageRoot);
  const headHash = index[threadId];
  if (headHash === undefined) {
    fail(`thread not found in threads.yaml: ${threadId}`);
  }

  const chain = walkChain(store, schemas, headHash);
  const workflow = await loadWorkflow(store, schemas, chain.start.workflow);
  const roleDef = workflow.roles[role];
  if (roleDef === undefined) {
    fail(`unknown role "${role}" in workflow "${workflow.name}"`);
  }

  const steps = await buildHistory(store, chain.stepsNewestFirst);

  return {
    threadId,
    role,
    start: chain.start,
    steps,
    workflow,
    store,
    outputFormatInstruction: "",
  };
}

export type BuildContextMeta = {
  storageRoot: string;
  store: Store;
  schemas: AgentStore["schemas"];
  headHash: CasRef;
  chain: ChainState;
};

/**
 * Same as {@link buildContext} but also returns chain metadata for writing the next StepNode.
 */
export async function buildContextWithMeta(
  threadId: ThreadId,
  role: string,
): Promise<AgentContext & { meta: BuildContextMeta }> {
  const storageRoot = resolveStorageRoot();
  const agentStore = await createAgentStore(storageRoot);
  const { store, schemas } = agentStore;

  const index = await loadThreadsIndex(storageRoot);
  const headHash = index[threadId];
  if (headHash === undefined) {
    fail(`thread not found in threads.yaml: ${threadId}`);
  }

  const chain = walkChain(store, schemas, headHash);
  const workflow = await loadWorkflow(store, schemas, chain.start.workflow);
  const roleDef = workflow.roles[role];
  if (roleDef === undefined) {
    fail(`unknown role "${role}" in workflow "${workflow.name}"`);
  }

  const steps = await buildHistory(store, chain.stepsNewestFirst);

  return {
    threadId,
    role,
    start: chain.start,
    steps,
    workflow,
    store,
    outputFormatInstruction: "",
    meta: { storageRoot, store, schemas, headHash, chain },
  };
}
