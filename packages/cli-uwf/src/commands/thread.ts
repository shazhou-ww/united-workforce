import { validate } from "@uncaged/json-cas";
import type {
  CasRef,
  StartNodePayload,
  StartOutput,
  StepNodePayload,
  StepOutput,
  ThreadId,
  ThreadListItem,
} from "@uncaged/uwf-protocol";
import { generateUlid } from "@uncaged/workflow-util";

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
