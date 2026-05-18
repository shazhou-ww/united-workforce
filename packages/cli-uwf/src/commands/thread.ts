import { execFileSync } from "node:child_process";

import { validate } from "@uncaged/json-cas";
import { getEnvPath, loadWorkflowConfig } from "@uncaged/uwf-agent-kit";
import { evaluate } from "@uncaged/uwf-moderator";
import type {
  AgentAlias,
  AgentConfig,
  CasRef,
  ModeratorContext,
  StartNodePayload,
  StartOutput,
  StepContext,
  StepNodePayload,
  StepOutput,
  ThreadId,
  ThreadListItem,
  WorkflowConfig,
  WorkflowPayload,
} from "@uncaged/uwf-protocol";
import { generateUlid } from "@uncaged/workflow-util";
import { config as loadDotenv } from "dotenv";

import {
  appendThreadHistory,
  createUwfStore,
  findThreadInHistory,
  loadThreadHistory,
  loadThreadsIndex,
  loadWorkflowRegistry,
  resolveWorkflowHash,
  saveThreadsIndex,
  type ThreadHistoryLine,
  type UwfStore,
} from "../store.js";
import { isCasRef } from "../validate.js";

const END_ROLE = "$END";

type ChainState = {
  startHash: CasRef;
  start: StartNodePayload;
  stepsNewestFirst: StepNodePayload[];
  headIsStart: boolean;
};

export type KillOutput = {
  thread: ThreadId;
  archived: boolean;
};

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function resolveWorkflowCasRef(
  uwf: UwfStore,
  storageRoot: string,
  workflowId: string,
): Promise<CasRef> {
  const registry = await loadWorkflowRegistry(storageRoot);
  const hash = resolveWorkflowHash(registry, workflowId);
  if (hash === null) {
    fail(`workflow not found: ${workflowId}`);
  }
  if (!isCasRef(hash)) {
    fail(`workflow not found: ${workflowId}`);
  }
  const node = uwf.store.get(hash);
  if (node === null) {
    fail(`CAS node not found: ${hash}`);
  }
  if (node.type !== uwf.schemas.workflow) {
    fail(`node ${hash} is not a Workflow (type ${node.type})`);
  }
  return hash;
}

function resolveWorkflowFromHead(uwf: UwfStore, head: CasRef): CasRef | null {
  const node = uwf.store.get(head);
  if (node === null) {
    return null;
  }

  if (node.type === uwf.schemas.startNode) {
    const payload = node.payload as StartNodePayload;
    return payload.workflow;
  }

  const payload = node.payload as StepNodePayload;
  if (typeof payload.start !== "string") {
    return null;
  }

  const startNode = uwf.store.get(payload.start);
  if (startNode === null || startNode.type !== uwf.schemas.startNode) {
    return null;
  }

  return (startNode.payload as StartNodePayload).workflow;
}

export async function cmdThreadStart(
  storageRoot: string,
  workflowId: string,
  prompt: string,
): Promise<StartOutput> {
  const uwf = await createUwfStore(storageRoot);
  const workflowHash = await resolveWorkflowCasRef(uwf, storageRoot, workflowId);

  const threadId = generateUlid(Date.now()) as ThreadId;
  const startPayload: StartNodePayload = {
    workflow: workflowHash,
    prompt,
  };

  const headHash = await uwf.store.put(uwf.schemas.startNode, startPayload);
  const node = uwf.store.get(headHash);
  if (node === null || !validate(uwf.store, node)) {
    fail("stored StartNode failed schema validation");
  }

  const index = await loadThreadsIndex(storageRoot);
  index[threadId] = headHash;
  await saveThreadsIndex(storageRoot, index);

  return { workflow: workflowHash, thread: threadId };
}

export async function cmdThreadShow(storageRoot: string, threadId: ThreadId): Promise<StepOutput> {
  const index = await loadThreadsIndex(storageRoot);
  const activeHead = index[threadId];
  if (activeHead !== undefined) {
    const uwf = await createUwfStore(storageRoot);
    const workflow = resolveWorkflowFromHead(uwf, activeHead);
    if (workflow === null) {
      fail(`failed to resolve workflow from head: ${activeHead}`);
    }
    return {
      workflow,
      thread: threadId,
      head: activeHead,
      done: false,
    };
  }

  const hist = await findThreadInHistory(storageRoot, threadId);
  if (hist !== null) {
    return {
      workflow: hist.workflow,
      thread: threadId,
      head: hist.head,
      done: true,
    };
  }

  fail(`thread not found: ${threadId}`);
}

async function threadListItemFromActive(
  uwf: UwfStore,
  threadId: ThreadId,
  head: CasRef,
): Promise<ThreadListItem | null> {
  const workflow = resolveWorkflowFromHead(uwf, head);
  if (workflow === null) {
    return null;
  }
  return { thread: threadId, workflow, head };
}

export async function cmdThreadList(
  storageRoot: string,
  includeAll: boolean,
): Promise<ThreadListItem[]> {
  const uwf = await createUwfStore(storageRoot);
  const index = await loadThreadsIndex(storageRoot);
  const items: ThreadListItem[] = [];

  for (const [threadId, head] of Object.entries(index)) {
    const item = await threadListItemFromActive(uwf, threadId as ThreadId, head);
    if (item !== null) {
      items.push(item);
    }
  }

  if (!includeAll) {
    return items;
  }

  const activeIds = new Set(items.map((i) => i.thread));
  const history = await loadThreadHistory(storageRoot);
  for (const entry of history) {
    if (!activeIds.has(entry.thread)) {
      items.push({
        thread: entry.thread,
        workflow: entry.workflow,
        head: entry.head,
      });
    }
  }

  return items;
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

function buildModeratorContext(uwf: UwfStore, chain: ChainState): ModeratorContext {
  const chronological = [...chain.stepsNewestFirst].reverse();
  const steps: StepContext[] = chronological.map((step) => ({
    role: step.role,
    output: expandOutput(uwf, step.output),
    detail: step.detail,
    agent: step.agent,
  }));
  return { start: chain.start, steps };
}

function loadWorkflowPayload(uwf: UwfStore, workflowRef: CasRef): WorkflowPayload {
  const node = uwf.store.get(workflowRef);
  if (node === null) {
    fail(`workflow CAS node not found: ${workflowRef}`);
  }
  if (node.type !== uwf.schemas.workflow) {
    fail(`node ${workflowRef} is not a Workflow`);
  }
  return node.payload as WorkflowPayload;
}

function parseAgentOverride(override: string): AgentConfig {
  const parts = override
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);
  const command = parts[0];
  if (command === undefined) {
    fail("agent override must not be empty");
  }
  return { command, args: parts.slice(1) };
}

function resolveAgentConfig(
  config: WorkflowConfig,
  workflow: WorkflowPayload,
  role: string,
  agentOverride: string | null,
): AgentConfig {
  if (agentOverride !== null) {
    return parseAgentOverride(agentOverride);
  }

  let alias: AgentAlias = config.defaultAgent;
  if (config.agentOverrides !== null) {
    const roleOverrides = config.agentOverrides[workflow.name];
    if (roleOverrides !== undefined && roleOverrides[role] !== undefined) {
      alias = roleOverrides[role];
    }
  }

  const agentConfig = config.agents[alias];
  if (agentConfig === undefined) {
    fail(`unknown agent alias in config: ${alias}`);
  }
  return agentConfig;
}

function spawnAgent(agent: AgentConfig, threadId: ThreadId, role: string): CasRef {
  const argv = [...agent.args, threadId, role];
  let stdout: string;
  try {
    stdout = execFileSync(agent.command, argv, {
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: Buffer | string };
    const stderr =
      err.stderr === undefined
        ? ""
        : typeof err.stderr === "string"
          ? err.stderr
          : err.stderr.toString("utf8");
    const detail = stderr.trim() !== "" ? `: ${stderr.trim()}` : "";
    fail(`agent command failed (${agent.command})${detail}`);
  }

  const line = stdout.trim().split("\n").pop()?.trim() ?? "";
  if (!isCasRef(line)) {
    fail(`agent stdout is not a valid CAS hash: ${line || "(empty)"}`);
  }
  return line;
}

async function archiveThread(
  storageRoot: string,
  threadId: ThreadId,
  workflow: CasRef,
  head: CasRef,
): Promise<void> {
  const index = await loadThreadsIndex(storageRoot);
  delete index[threadId];
  await saveThreadsIndex(storageRoot, index);
  await appendThreadHistory(storageRoot, {
    thread: threadId,
    workflow,
    head,
    completedAt: Date.now(),
  });
}

export async function cmdThreadStep(
  storageRoot: string,
  threadId: ThreadId,
  agentOverride: string | null,
): Promise<StepOutput> {
  const index = await loadThreadsIndex(storageRoot);
  const headHash = index[threadId];
  if (headHash === undefined) {
    fail(`thread not active: ${threadId}`);
  }

  const uwf = await createUwfStore(storageRoot);
  const chain = walkChain(uwf, headHash);
  const workflowHash = chain.start.workflow;
  const workflow = loadWorkflowPayload(uwf, workflowHash);
  const context = buildModeratorContext(uwf, chain);

  const nextResult = evaluate(workflow, context);
  if (!nextResult.ok) {
    fail(nextResult.error.message);
  }

  if (nextResult.value === END_ROLE) {
    await archiveThread(storageRoot, threadId, workflowHash, headHash);
    return {
      workflow: workflowHash,
      thread: threadId,
      head: headHash,
      done: true,
    };
  }

  const role = nextResult.value;
  const config = await loadWorkflowConfig(storageRoot);
  const agent = resolveAgentConfig(config, workflow, role, agentOverride);

  loadDotenv({ path: getEnvPath(storageRoot) });
  const newHead = spawnAgent(agent, threadId, role);

  const newNode = uwf.store.get(newHead);
  if (newNode === null || newNode.type !== uwf.schemas.stepNode) {
    fail(`agent returned hash that is not a StepNode: ${newHead}`);
  }

  index[threadId] = newHead;
  await saveThreadsIndex(storageRoot, index);

  const chainAfter = walkChain(uwf, newHead);
  const contextAfter = buildModeratorContext(uwf, chainAfter);
  const afterResult = evaluate(workflow, contextAfter);
  if (!afterResult.ok) {
    fail(afterResult.error.message);
  }

  const done = afterResult.value === END_ROLE;
  if (done) {
    await archiveThread(storageRoot, threadId, workflowHash, newHead);
  }

  return {
    workflow: workflowHash,
    thread: threadId,
    head: newHead,
    done,
  };
}

export async function cmdThreadKill(storageRoot: string, threadId: ThreadId): Promise<KillOutput> {
  const index = await loadThreadsIndex(storageRoot);
  const head = index[threadId];
  if (head === undefined) {
    fail(`thread not active: ${threadId}`);
  }

  const uwf = await createUwfStore(storageRoot);
  const workflow = resolveWorkflowFromHead(uwf, head);
  if (workflow === null) {
    fail(`failed to resolve workflow from head: ${head}`);
  }

  delete index[threadId];
  await saveThreadsIndex(storageRoot, index);

  const historyEntry: ThreadHistoryLine = {
    thread: threadId,
    workflow,
    head,
    completedAt: Date.now(),
  };
  await appendThreadHistory(storageRoot, historyEntry);

  return { thread: threadId, archived: true };
}
