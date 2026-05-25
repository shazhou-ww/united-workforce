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
 * Read a step's agent turns as human-readable markdown with quota enforcement
 */
export async function cmdStepRead(
  storageRoot: string,
  stepHash: CasRef,
  quota: number,
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

  // Build header section
  const parts: string[] = [];
  parts.push(`# Step ${stepHash}`);
  parts.push("");
  parts.push(`**Role:** ${payload.role}`);
  parts.push(`**Agent:** ${payload.agent}`);

  // If no detail, return metadata only
  if (payload.detail === null) {
    return parts.join("\n");
  }

  // Load detail node
  const detailNode = uwf.store.get(payload.detail);
  if (detailNode === null) {
    fail(`detail node not found: ${payload.detail}`);
  }

  const detail = detailNode.payload as Record<string, unknown>;
  const turns = detail.turns;

  // If no turns array, return metadata only
  if (!Array.isArray(turns) || turns.length === 0) {
    return parts.join("\n");
  }

  // Load all turn nodes
  type TurnData = {
    index: number;
    content: string;
  };
  const turnData: TurnData[] = [];
  for (const turnRef of turns) {
    if (typeof turnRef !== "string") {
      continue;
    }
    const turnNode = uwf.store.get(turnRef as CasRef);
    if (turnNode === null) {
      continue;
    }
    const turn = turnNode.payload as Record<string, unknown>;
    if (typeof turn.content === "string") {
      turnData.push({
        index: typeof turn.index === "number" ? turn.index : turnData.length,
        content: turn.content,
      });
    }
  }

  if (turnData.length === 0) {
    return parts.join("\n");
  }

  // Calculate header length for quota accounting
  const headerSection = parts.join("\n");
  const headerLength = headerSection.length;

  // Select turns that fit within quota (working backwards from most recent)
  const BUFFER = 200; // Conservative buffer for structural overhead
  const availableQuota = quota - headerLength - BUFFER;

  const selectedTurns: TurnData[] = [];
  let totalChars = 0;

  for (let i = turnData.length - 1; i >= 0; i--) {
    const turn = turnData[i];
    if (turn === undefined) continue;

    // Calculate formatted turn length
    const turnHeader = `## Turn ${turn.index + 1}\n\n`;
    const turnBlock = turnHeader + turn.content;
    const separatorCost = selectedTurns.length > 0 ? 2 : 0; // "\n\n" between turns
    const addCost = turnBlock.length + separatorCost;

    // Check quota - but always include at least one turn
    if (totalChars + addCost > availableQuota && selectedTurns.length > 0) {
      break;
    }

    selectedTurns.unshift(turn);
    totalChars += addCost;
  }

  // Add skip hint if not all turns fit
  const skippedCount = turnData.length - selectedTurns.length;
  if (skippedCount > 0) {
    parts.push("");
    parts.push(`_[Earlier turns omitted due to quota. Use --quota to increase.]_`);
  }

  // Add selected turns
  for (const turn of selectedTurns) {
    parts.push("");
    parts.push(`## Turn ${turn.index + 1}`);
    parts.push("");
    parts.push(turn.content);
  }

  return parts.join("\n");
}
