import { execFileSync } from "node:child_process";
import type { Store as CasStore, JSONSchema } from "@uncaged/json-cas";
import { getSchema, validate } from "@uncaged/json-cas";
import { getEnvPath, loadWorkflowConfig } from "@uncaged/workflow-agent-kit";
import { evaluate } from "@uncaged/workflow-moderator";
import type {
  AgentAlias,
  AgentConfig,
  CasRef,
  ModeratorContext,
  StartEntry,
  StartNodePayload,
  StartOutput,
  StepContext,
  StepEntry,
  StepNodePayload,
  StepOutput,
  ThreadForkOutput,
  ThreadId,
  ThreadListItem,
  ThreadStepsOutput,
  WorkflowConfig,
  WorkflowPayload,
} from "@uncaged/workflow-protocol";
import { generateUlid } from "@uncaged/workflow-util";
import { config as loadDotenv } from "dotenv";
import { stringify } from "yaml";

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
export const THREAD_READ_DEFAULT_QUOTA = 4000;

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

function expandValue(
  store: CasStore,
  schema: JSONSchema,
  value: unknown,
  visited: Set<string>,
): unknown {
  // If this field is a cas_ref, expand it
  if (schema.format === "cas_ref") {
    if (typeof value === "string") {
      return expandDeep(store, value as CasRef, visited);
    }
    return value;
  }

  // anyOf (nullable refs)
  if (Array.isArray(schema.anyOf)) {
    for (const sub of schema.anyOf as JSONSchema[]) {
      if (sub.format === "cas_ref" && typeof value === "string") {
        return expandDeep(store, value as CasRef, visited);
      }
    }
    return value;
  }

  // Array of cas_ref items
  if (schema.type === "array" && schema.items && Array.isArray(value)) {
    const itemSchema = schema.items as JSONSchema;
    return (value as unknown[]).map((item) => expandValue(store, itemSchema, item, visited));
  }

  // Object with properties
  if (value !== null && typeof value === "object" && !Array.isArray(value) && schema.properties) {
    const props = schema.properties as Record<string, JSONSchema>;
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      const propSchema = props[key];
      result[key] = propSchema ? expandValue(store, propSchema, val, visited) : val;
    }
    return result;
  }

  return value;
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

function formatYaml(value: unknown): string {
  return stringify(value).trimEnd();
}

function formatCompactStep(index: number, item: OrderedStepItem, outputYaml: string): string {
  return [
    `## Step ${index}: ${item.payload.role}`,
    "",
    `- **Hash:** \`${item.hash}\``,
    `- **Agent:** ${item.payload.agent}`,
    "",
    "### Output",
    "",
    "```yaml",
    outputYaml,
    "```",
  ].join("\n");
}

export function extractLastAssistantContent(uwf: UwfStore, detailRef: CasRef): string | null {
  const detailNode = uwf.store.get(detailRef);
  if (detailNode === null) {
    return null;
  }
  const detail = detailNode.payload as Record<string, unknown>;
  const turns = detail.turns;
  if (!Array.isArray(turns) || turns.length === 0) {
    return null;
  }
  for (let i = turns.length - 1; i >= 0; i--) {
    const turnRef = turns[i];
    if (typeof turnRef !== "string") {
      continue;
    }
    const turnNode = uwf.store.get(turnRef as CasRef);
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

function formatThreadReadMarkdown(options: {
  threadId: ThreadId;
  workflowName: string;
  workflowHash: CasRef;
  prompt: string;
  ordered: OrderedStepItem[];
  uwf: UwfStore;
  workflow: WorkflowPayload;
  quota: number;
  before: CasRef | null;
  showStart: boolean;
}): string {
  const { ordered, uwf, workflow, quota, before, showStart } = options;

  // Determine which steps to consider
  let candidates = ordered;
  if (before !== null) {
    const idx = candidates.findIndex((s) => s.hash === before);
    if (idx === -1) {
      fail(`step ${before} not found in thread ${options.threadId}`);
    }
    candidates = candidates.slice(0, idx);
  }

  // Walk backward from newest, accumulating chars until quota exceeded
  const selected: OrderedStepItem[] = [];
  let totalChars = 0;
  for (let i = candidates.length - 1; i >= 0; i--) {
    const item = candidates[i];
    if (item === undefined) continue;
    const outputYaml = formatYaml(expandOutput(uwf, item.payload.output));
    const blockLen = formatCompactStep(i + 1, item, outputYaml).length;
    selected.unshift(item);
    totalChars += blockLen;
    if (totalChars > quota) break;
  }

  const skippedCount = candidates.length - selected.length;
  const parts: string[] = [];

  // Start section
  if (before === null || showStart) {
    parts.push(
      [
        `# Thread \`${options.threadId}\``,
        "",
        `**Workflow:** ${options.workflowName} (\`${options.workflowHash}\`)`,
        "",
        "## Task",
        "",
        options.prompt,
      ].join("\n"),
    );
  }

  // Skip hint
  if (skippedCount > 0 && selected.length > 0) {
    const firstSelected = selected[0];
    if (firstSelected !== undefined) {
      parts.push(
        `*(${skippedCount} earlier step${skippedCount > 1 ? "s" : ""}, load with \`uwf thread read ${options.threadId} --before ${firstSelected.hash}\`)*`,
      );
    }
  }

  // Step blocks
  const startIndex = candidates.length - selected.length;
  for (let i = 0; i < selected.length; i++) {
    const item = selected[i];
    if (item === undefined) continue;
    const stepNum = startIndex + i + 1;
    const outputYaml = formatYaml(expandOutput(uwf, item.payload.output));
    const ts = new Date(item.timestamp)
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d+Z$/, "");
    const stepLines = [
      `## Step ${stepNum}: ${item.payload.role} \`${item.hash}\``,
      `**Agent:** ${item.payload.agent} | **Time:** ${ts}`,
    ];
    const roleDef = workflow.roles[item.payload.role];
    if (roleDef) {
      stepLines.push("", "### Prompt", "", roleDef.systemPrompt);
    }
    if (item.payload.detail) {
      const content = extractLastAssistantContent(uwf, item.payload.detail);
      if (content !== null) {
        stepLines.push("", "### Content", "", content);
      }
    }
    stepLines.push("", "### Output", "", "```yaml", outputYaml, "```");
    parts.push(stepLines.join("\n"));
  }

  return parts.join("\n\n---\n\n");
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

  const nextResult = await evaluate(workflow, context);
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

  // Re-create store to pick up nodes written by the agent subprocess
  const uwfAfter = await createUwfStore(storageRoot);
  const newNode = uwfAfter.store.get(newHead);
  if (newNode === null || newNode.type !== uwfAfter.schemas.stepNode) {
    fail(`agent returned hash that is not a StepNode: ${newHead}`);
  }

  // Reload threads index to avoid overwriting changes made by the agent subprocess
  const freshIndex = await loadThreadsIndex(storageRoot);
  freshIndex[threadId] = newHead;
  await saveThreadsIndex(storageRoot, freshIndex);

  const chainAfter = walkChain(uwfAfter, newHead);
  const contextAfter = buildModeratorContext(uwfAfter, chainAfter);
  const afterResult = await evaluate(workflow, contextAfter);
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

export async function cmdThreadSteps(
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

export async function cmdThreadRead(
  storageRoot: string,
  threadId: ThreadId,
  quota: number = THREAD_READ_DEFAULT_QUOTA,
  before: CasRef | null = null,
  showStart: boolean = false,
): Promise<string> {
  const headHash = await resolveHeadHash(storageRoot, threadId);
  const uwf = await createUwfStore(storageRoot);
  const chain = walkChain(uwf, headHash);
  const workflow = loadWorkflowPayload(uwf, chain.start.workflow);
  const ordered = collectOrderedSteps(uwf, headHash, chain);

  return formatThreadReadMarkdown({
    threadId,
    workflowName: workflow.name,
    workflowHash: chain.start.workflow,
    prompt: chain.start.prompt,
    ordered,
    uwf,
    workflow,
    quota,
    before,
    showStart,
  });
}

export async function cmdThreadFork(
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

export async function cmdThreadStepDetails(
  storageRoot: string,
  stepHash: CasRef,
): Promise<unknown> {
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
