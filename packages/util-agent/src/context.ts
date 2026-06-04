import type { Store } from "@ocas/core";
import type {
  CasRef,
  StartNodePayload,
  StepContext,
  StepNodePayload,
  ThreadId,
} from "@united-workforce/protocol";
import type { AgentStore } from "./storage.js";
import { createAgentStore, getActiveThreadEntry } from "./storage.js";
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

function walkChain(store: Store, schemas: AgentStore["schemas"], headHash: CasRef): ChainState {
  const headNode = store.cas.get(headHash);
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
    const node = store.cas.get(hash);
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

  const startNode = store.cas.get(newest.start);
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

function expandOutput(store: Store, outputRef: CasRef): unknown {
  const node = store.cas.get(outputRef);
  if (node === null) {
    return {};
  }
  return node.payload;
}

function extractStepContent(store: Store, detailRef: CasRef): string | null {
  const detailNode = store.cas.get(detailRef);
  if (detailNode === null) {
    return null;
  }
  const detail = detailNode.payload as Record<string, unknown>;
  const turns = detail.turns;
  if (!Array.isArray(turns) || turns.length === 0) {
    return null;
  }
  // Find last assistant content (same logic as extractLastAssistantContent in cli)
  for (let i = turns.length - 1; i >= 0; i--) {
    const turnRef = turns[i];
    if (typeof turnRef !== "string") {
      continue;
    }
    const turnNode = store.cas.get(turnRef as CasRef);
    if (turnNode === null) {
      continue;
    }
    const turn = turnNode.payload as Record<string, unknown>;
    if (
      turn.role === "assistant" &&
      typeof turn.content === "string" &&
      turn.content.trim() !== ""
    ) {
      return turn.content;
    }
  }
  return null;
}

async function buildHistory(
  store: Store,
  stepsNewestFirst: StepNodePayload[],
): Promise<StepContext[]> {
  const chronological = [...stepsNewestFirst].reverse();
  const history: StepContext[] = [];
  for (const step of chronological) {
    const content = extractStepContent(store, step.detail);
    history.push({
      role: step.role,
      output: expandOutput(store, step.output),
      detail: step.detail,
      agent: step.agent,
      edgePrompt: step.edgePrompt ?? "",
      startedAtMs: step.startedAtMs,
      completedAtMs: step.completedAtMs,
      cwd: step.cwd ?? "",
      assembledPrompt: step.assembledPrompt ?? null,
      content,
    });
  }
  return history;
}

async function loadWorkflow(store: Store, schemas: AgentStore["schemas"], workflowRef: CasRef) {
  const node = store.cas.get(workflowRef);
  if (node === null) {
    fail(`workflow CAS node not found: ${workflowRef}`);
  }
  if (node.type !== schemas.workflow) {
    fail(`node ${workflowRef} is not a Workflow`);
  }
  return node.payload as AgentContext["workflow"];
}

/**
 * Build agent execution context from thread head in the variable store.
 * Walks the CAS chain from head to StartNode and expands step outputs.
 */
export async function buildContext(
  threadId: ThreadId,
  role: string,
  edgePrompt: string,
  storageRoot: string,
  casDir: string,
): Promise<AgentContext> {
  const agentStore = await createAgentStore(storageRoot, casDir);
  const { store, schemas } = agentStore;

  const entry = await getActiveThreadEntry(casDir, threadId);
  if (entry === null) {
    fail(`thread not found in active thread index: ${threadId}`);
  }

  const chain = walkChain(store, schemas, entry.head);
  const workflow = await loadWorkflow(store, schemas, chain.start.workflow);
  const roleDef = workflow.roles[role];
  if (roleDef === undefined) {
    fail(`unknown role "${role}" in workflow "${workflow.name}"`);
  }

  const steps = await buildHistory(store, chain.stepsNewestFirst);
  const isFirstVisit = !steps.some((s) => s.role === role);

  return {
    threadId,
    role,
    start: chain.start,
    steps,
    workflow,
    store,
    outputFormatInstruction: "",
    edgePrompt,
    isFirstVisit,
    storageRoot,
    casDir,
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
  edgePrompt: string,
  storageRoot: string,
  casDir: string,
): Promise<AgentContext & { meta: BuildContextMeta }> {
  const agentStore = await createAgentStore(storageRoot, casDir);
  const { store, schemas } = agentStore;

  const entry = await getActiveThreadEntry(casDir, threadId);
  if (entry === null) {
    fail(`thread not found in active thread index: ${threadId}`);
  }

  const chain = walkChain(store, schemas, entry.head);
  const workflow = await loadWorkflow(store, schemas, chain.start.workflow);
  const roleDef = workflow.roles[role];
  if (roleDef === undefined) {
    fail(`unknown role "${role}" in workflow "${workflow.name}"`);
  }

  const steps = await buildHistory(store, chain.stepsNewestFirst);
  const isFirstVisit = !steps.some((s) => s.role === role);

  return {
    threadId,
    role,
    start: chain.start,
    steps,
    workflow,
    store,
    outputFormatInstruction: "",
    edgePrompt,
    isFirstVisit,
    storageRoot,
    casDir,
    meta: { storageRoot, store, schemas, headHash: entry.head, chain },
  };
}
