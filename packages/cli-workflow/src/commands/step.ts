import type { BootstrapCapableStore } from "@uncaged/json-cas";
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

type TurnToolCall = {
  name: string;
  args: string;
};

type TurnData = {
  index: number;
  role: string;
  content: string;
  toolCalls: TurnToolCall[] | null;
};

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
      durationMs: item.payload.completedAtMs - item.payload.startedAtMs,
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
 * Load and validate step detail node from CAS store
 */
function loadStepDetail(store: BootstrapCapableStore, detailRef: CasRef): Record<string, unknown> {
  const detailNode = store.get(detailRef);
  if (detailNode === null) {
    fail(`detail node not found: ${detailRef}`);
  }
  return detailNode.payload as Record<string, unknown>;
}

function parseTurnToolCalls(raw: unknown): TurnToolCall[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }
  const calls: TurnToolCall[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const name = record.name;
    const args = record.args;
    if (typeof name === "string") {
      calls.push({ name, args: typeof args === "string" ? args : "" });
    }
  }
  return calls.length > 0 ? calls : null;
}

function formatTurnBody(turn: TurnData): string {
  const parts: string[] = [];
  parts.push(`**Turn role:** ${turn.role}`);

  if (turn.toolCalls !== null) {
    for (const call of turn.toolCalls) {
      const argsSuffix = call.args !== "" ? ` — \`${call.args}\`` : "";
      parts.push(`- **${call.name}**${argsSuffix}`);
    }
  }

  if (turn.content !== "") {
    if (parts.length > 0) {
      parts.push("");
    }
    parts.push(turn.content);
  }

  return parts.join("\n");
}

function parseSingleTurn(
  store: BootstrapCapableStore,
  turnRef: unknown,
  fallbackIndex: number,
): TurnData | null {
  if (typeof turnRef !== "string") {
    return null;
  }
  const turnNode = store.get(turnRef as CasRef);
  if (turnNode === null) {
    return null;
  }
  const turn = turnNode.payload as Record<string, unknown>;
  const content = typeof turn.content === "string" ? turn.content : "";
  const toolCalls = parseTurnToolCalls(turn.toolCalls);
  if (content === "" && toolCalls === null) {
    return null;
  }
  return {
    index: typeof turn.index === "number" ? turn.index : fallbackIndex,
    role: typeof turn.role === "string" ? turn.role : "assistant",
    content,
    toolCalls,
  };
}

/**
 * Load all turn nodes from CAS store and extract display fields
 */
function loadTurnData(store: BootstrapCapableStore, turns: unknown): TurnData[] {
  if (!Array.isArray(turns) || turns.length === 0) {
    return [];
  }

  const turnData: TurnData[] = [];
  for (const turnRef of turns) {
    const parsed = parseSingleTurn(store, turnRef, turnData.length);
    if (parsed !== null) {
      turnData.push(parsed);
    }
  }
  return turnData;
}

/**
 * Select turns that fit within quota, working backwards from most recent
 */
function selectTurnsForQuota(turnData: TurnData[], availableQuota: number): TurnData[] {
  const selectedTurns: TurnData[] = [];
  let totalChars = 0;

  for (let i = turnData.length - 1; i >= 0; i--) {
    const turn = turnData[i];
    if (turn === undefined) continue;

    const turnHeader = `## Turn ${turn.index + 1}\n\n`;
    const turnBlock = turnHeader + formatTurnBody(turn);
    const separatorCost = selectedTurns.length > 0 ? 2 : 0;
    const addCost = turnBlock.length + separatorCost;

    if (totalChars + addCost > availableQuota && selectedTurns.length > 0) {
      break;
    }

    selectedTurns.unshift(turn);
    totalChars += addCost;
  }

  return selectedTurns;
}

/**
 * Assemble final markdown output from header and selected turns
 */
function formatStepMarkdown(
  stepHash: CasRef,
  role: string,
  agent: string,
  turnData: TurnData[],
  selectedTurns: TurnData[],
): string {
  const parts: string[] = [];
  parts.push(`# Step ${stepHash}`);
  parts.push("");
  parts.push(`**Role:** ${role}`);
  parts.push(`**Agent:** ${agent}`);

  if (selectedTurns.length === 0) {
    return parts.join("\n");
  }

  const skippedCount = turnData.length - selectedTurns.length;
  if (skippedCount > 0) {
    parts.push("");
    parts.push(`_[Earlier turns omitted due to quota. Use --quota to increase.]_`);
  }

  for (const turn of selectedTurns) {
    parts.push("");
    parts.push(`## Turn ${turn.index + 1}`);
    parts.push("");
    parts.push(formatTurnBody(turn));
  }

  return parts.join("\n");
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

  if (payload.detail === null) {
    return formatStepMarkdown(stepHash, payload.role, payload.agent, [], []);
  }

  const detail = loadStepDetail(uwf.store, payload.detail);
  const turnData = loadTurnData(uwf.store, detail.turns);

  if (turnData.length === 0) {
    return formatStepMarkdown(stepHash, payload.role, payload.agent, [], []);
  }

  const headerSection = formatStepMarkdown(stepHash, payload.role, payload.agent, [], []);
  const BUFFER = 200;
  const availableQuota = quota - headerSection.length - BUFFER;
  const selectedTurns = selectTurnsForQuota(turnData, availableQuota);

  return formatStepMarkdown(stepHash, payload.role, payload.agent, turnData, selectedTurns);
}
