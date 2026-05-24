import type {
  CasRef,
  StartEntry,
  StepEntry,
  StepNodePayload,
  ThreadForkOutput,
  ThreadId,
  ThreadStepsOutput,
} from "@uncaged/workflow-protocol";
import { generateUlid } from "@uncaged/workflow-util";
import { createUwfStore, loadThreadsIndex, saveThreadsIndex } from "../store.js";
import {
  collectOrderedSteps,
  expandDeep,
  expandOutput,
  fail,
  resolveHeadHash,
  walkChain,
} from "./shared.js";

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
      detail: item.payload.detail ?? null,
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
  _before: number | null = null,
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
