import { execFileSync, spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import type { VarStore } from "@ocas/core";
import { validate } from "@ocas/core";
import type {
  AgentAlias,
  AgentConfig,
  CasRef,
  StartNodePayload,
  StartOutput,
  StepNodePayload,
  StepOutput,
  ThreadId,
  ThreadIndexEntry,
  ThreadListItem,
  ThreadStatus,
  ThreadsIndex,
  WorkflowConfig,
  WorkflowPayload,
} from "@united-workforce/protocol";
import {
  createThreadIndexEntry,
  markThreadSuspended,
  updateThreadHead,
} from "@united-workforce/protocol";
import {
  createProcessLogger,
  extractUlidTimestamp,
  generateUlid,
  type ProcessLogger,
} from "@united-workforce/util";
import type { AdapterOutput } from "@united-workforce/util-agent";
import { getEnvPath, loadWorkflowConfig } from "@united-workforce/util-agent";
import { config as loadDotenv } from "dotenv";
import { parse } from "yaml";
import { createMarker, deleteMarker, isThreadRunning } from "../background/index.js";
import { createIncludeTag } from "../include.js";
import { evaluate, isSuspendResult } from "../moderator/index.js";
import {
  completeThread,
  createUwfStore,
  getThread,
  loadActiveThreads,
  loadHistoryThreads,
  loadWorkflowRegistry,
  resolveWorkflowHash,
  setThread,
  type UwfStore,
} from "../store.js";
import { checkWorkflowFilenameConsistency, isCasRef, parseWorkflowPayload } from "../validate.js";
import { validateWorkflow } from "../validate-semantic.js";
import {
  type ChainState,
  collectOrderedSteps,
  expandOutput,
  fail,
  type OrderedStepItem,
  walkChain,
} from "./shared.js";
import { materializeWorkflowPayload } from "./workflow.js";

const END_ROLE = "$END";
const START_ROLE = "$START";
export const THREAD_READ_DEFAULT_QUOTA = 4000;

function buildStepOutputFromEvaluation(
  workflowHash: CasRef,
  threadId: ThreadId,
  head: CasRef,
  status: ThreadStatus,
  evaluation: ReturnType<typeof evaluate>,
  background: boolean | null,
): StepOutput {
  const done = status === "completed";
  let currentRole: string | null = null;
  let suspendedRole: string | null = null;
  let suspendMessage: string | null = null;
  if (evaluation.ok) {
    if (isSuspendResult(evaluation.value)) {
      suspendedRole = evaluation.value.suspendedRole;
      suspendMessage = evaluation.value.prompt;
    } else if (evaluation.value.role !== END_ROLE) {
      currentRole = evaluation.value.role;
    }
  }
  return {
    workflow: workflowHash,
    thread: threadId,
    head,
    status,
    currentRole,
    suspendedRole,
    suspendMessage,
    done,
    background,
  };
}

function resolveSuspendFieldsFromGraph(
  uwf: UwfStore,
  head: CasRef,
  workflowRef: CasRef,
): { suspendedRole: string | null; suspendMessage: string | null } {
  const chain = walkChain(uwf, head);
  const { lastRole, lastOutput } = resolveEvaluateArgs(uwf, chain);
  const workflow = loadWorkflowPayload(uwf, workflowRef);
  const result = evaluate(workflow.graph, lastRole, lastOutput);
  if (result.ok && isSuspendResult(result.value)) {
    return {
      suspendedRole: result.value.suspendedRole,
      suspendMessage: result.value.prompt,
    };
  }
  return { suspendedRole: null, suspendMessage: null };
}

function resolveSuspendFieldsForShow(
  entry: ThreadIndexEntry,
  status: ThreadStatus,
  uwf: UwfStore,
  head: CasRef,
  workflowRef: CasRef,
): { suspendedRole: string | null; suspendMessage: string | null } {
  if (status !== "suspended") {
    return { suspendedRole: null, suspendMessage: null };
  }
  if (entry.suspendedRole !== null && entry.suspendMessage !== null) {
    return { suspendedRole: entry.suspendedRole, suspendMessage: entry.suspendMessage };
  }
  const fromGraph = resolveSuspendFieldsFromGraph(uwf, head, workflowRef);
  return {
    suspendedRole: entry.suspendedRole ?? fromGraph.suspendedRole,
    suspendMessage: entry.suspendMessage ?? fromGraph.suspendMessage,
  };
}

async function ensureThreadSuspendMetadata(
  varStore: VarStore,
  threadId: ThreadId,
  entry: ThreadIndexEntry,
  suspendedRole: string,
  suspendMessage: string,
): Promise<ThreadIndexEntry> {
  if (entry.suspendedRole !== null && entry.suspendMessage !== null) {
    return entry;
  }
  const updated = markThreadSuspended(entry, suspendedRole, suspendMessage);
  setThread(varStore, threadId, updated);
  return updated;
}

async function resolveActiveThreadStatus(
  storageRoot: string,
  threadId: ThreadId,
  uwf: UwfStore,
  head: CasRef,
  workflowRef: CasRef,
): Promise<ThreadStatus> {
  const runningMarker = await isThreadRunning(storageRoot, threadId);
  if (runningMarker !== null) {
    return "running";
  }

  const chain = walkChain(uwf, head);
  const { lastRole, lastOutput } = resolveEvaluateArgs(uwf, chain);
  const workflow = loadWorkflowPayload(uwf, workflowRef);
  const result = evaluate(workflow.graph, lastRole, lastOutput);
  if (result.ok && isSuspendResult(result.value)) {
    return "suspended";
  }

  return "idle";
}

/**
 * Derive the current/next role from the workflow graph and chain state.
 * Returns null when the next role is $END, thread is suspended, or evaluation fails.
 */
function resolveCurrentRole(uwf: UwfStore, head: CasRef, workflowRef: CasRef): string | null {
  const chain = walkChain(uwf, head);
  const { lastRole, lastOutput } = resolveEvaluateArgs(uwf, chain);
  const workflow = loadWorkflowPayload(uwf, workflowRef);
  const result = evaluate(workflow.graph, lastRole, lastOutput);
  if (!result.ok) {
    return null;
  }
  if (isSuspendResult(result.value) || result.value.role === END_ROLE) {
    return null;
  }
  return result.value.role;
}

const PL_THREAD_START = "7HNQ4B2X";
const PL_MODERATOR = "M3K8V9T1";
const PL_AGENT_SPAWN = "R5J2W8N4";
const PL_AGENT_DONE = "C6P9E3H7";
const PL_THREAD_ARCHIVED = "F4D8Q2K5";
const PL_STEP_ERROR = "B8T5N1V6";
const PL_BACKGROUND_START = "X7Q4W9M2";
const PL_THREAD_RESUME = "K2R7M4N8";

type ResumeStepConfig = {
  role: string;
  prompt: string;
};

type AgentStepTarget = {
  role: string;
  edgePrompt: string;
  effectiveCwd: string;
};

function buildResumePrompt(graphPrompt: string, supplement: string | null): string {
  if (supplement === null || supplement === "") {
    return graphPrompt;
  }
  return `${graphPrompt}\n\n${supplement}`;
}

function failStep(plog: ProcessLogger, message: string): never {
  plog.log(PL_STEP_ERROR, message, null);
  fail(message);
}

/**
 * Check if a string looks like a file path (contains path separators or has .yaml/.yml extension).
 */
function isFilePath(input: string): boolean {
  return (
    input.includes("/") || input.includes("\\") || input.endsWith(".yaml") || input.endsWith(".yml")
  );
}

/**
 * Check if a workflow file exists at the given path.
 */
async function workflowFileExists(dir: string, name: string, ext: string): Promise<string | null> {
  const candidate = resolvePath(dir, `${name}${ext}`);
  try {
    await access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

/**
 * Search for a workflow file in a given directory (checks both .workflow/ and .workflows/).
 */
async function findWorkflowInDir(dir: string, name: string): Promise<string | null> {
  // Check .workflow/ directory first (preferred)
  for (const ext of [".yaml", ".yml"]) {
    const result = await workflowFileExists(resolvePath(dir, ".workflow"), name, ext);
    if (result !== null) {
      return result;
    }
  }
  for (const indexName of ["index.yaml", "index.yml"]) {
    const candidate = resolvePath(dir, ".workflow", name, indexName);
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* not found */
    }
  }

  // Check .workflows/ directory as fallback (legacy)
  for (const ext of [".yaml", ".yml"]) {
    const result = await workflowFileExists(resolvePath(dir, ".workflows"), name, ext);
    if (result !== null) {
      return result;
    }
  }
  for (const indexName of ["index.yaml", "index.yml"]) {
    const candidate = resolvePath(dir, ".workflows", name, indexName);
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* not found */
    }
  }

  return null;
}

/**
 * Traverse parent directories looking for `.workflow/<name>.yaml` or `.workflow/<name>.yml`.
 * Returns the absolute path if found, otherwise null.
 * Stops at filesystem root or .git directory.
 */
async function findWorkflowInParents(startDir: string, name: string): Promise<string | null> {
  let currentDir = resolvePath(startDir);
  const root = resolvePath("/");

  while (true) {
    const found = await findWorkflowInDir(currentDir, name);
    if (found !== null) {
      return found;
    }

    // Stop at filesystem root
    if (currentDir === root) {
      break;
    }

    // Move to parent directory
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached filesystem root
      break;
    }
    currentDir = parentDir;
  }

  return null;
}

async function materializeLocalWorkflow(uwf: UwfStore, filePath: string): Promise<CasRef> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    fail(`project workflow file not found: ${filePath}`);
  }

  let raw: unknown;
  try {
    raw = parse(text, { customTags: [createIncludeTag(dirname(filePath))] }) as unknown;
  } catch (e) {
    fail(`invalid YAML in ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
  }

  const payload = parseWorkflowPayload(raw);
  if (payload === null) {
    fail(`invalid workflow YAML in ${filePath}: expected WorkflowPayload shape`);
  }

  const filenameError = checkWorkflowFilenameConsistency(filePath, payload);
  if (filenameError !== null) {
    fail(filenameError);
  }

  const semanticErrors = validateWorkflow(payload);
  if (semanticErrors.length > 0) {
    fail(`workflow validation failed:\n${semanticErrors.map((e) => `  - ${e}`).join("\n")}`);
  }

  const materialized = await materializeWorkflowPayload(uwf, payload);
  const hash = await uwf.store.cas.put(uwf.schemas.workflow, materialized);
  const stored = uwf.store.cas.get(hash);
  if (stored === null || !validate(uwf.store, stored)) {
    fail("stored local workflow failed schema validation");
  }

  return hash;
}

async function resolveWorkflowCasRef(
  uwf: UwfStore,
  workflowId: string,
  projectRoot: string,
): Promise<CasRef> {
  // Validate input
  const trimmed = workflowId.trim();
  if (trimmed === "") {
    fail("workflow ID cannot be empty");
  }

  // Strategy 1: Direct CAS hash
  if (isCasRef(trimmed)) {
    const node = uwf.store.cas.get(trimmed);
    if (node === null) {
      fail(`CAS node not found: ${trimmed}`);
    }
    if (node.type !== uwf.schemas.workflow) {
      fail(`node ${trimmed} is not a Workflow (type ${node.type})`);
    }
    return trimmed;
  }

  // Strategy 2: Explicit file path (relative or absolute)
  if (isFilePath(trimmed)) {
    const absolutePath = isAbsolute(trimmed) ? trimmed : resolvePath(projectRoot, trimmed);
    return materializeLocalWorkflow(uwf, absolutePath);
  }

  // Strategy 3: Local discovery (parent directory traversal)
  const localPath = await findWorkflowInParents(projectRoot, trimmed);
  if (localPath !== null) {
    return materializeLocalWorkflow(uwf, localPath);
  }

  // Strategy 4: Global registry fallback
  const registry = loadWorkflowRegistry(uwf.varStore);
  const hash = resolveWorkflowHash(registry, trimmed);
  if (!isCasRef(hash)) {
    fail(`workflow not found: ${trimmed}`);
  }
  const node = uwf.store.cas.get(hash);
  if (node === null) {
    fail(`CAS node not found: ${hash}`);
  }
  if (node.type !== uwf.schemas.workflow) {
    fail(`node ${hash} is not a Workflow (type ${node.type})`);
  }
  return hash;
}

function resolveWorkflowFromHead(uwf: UwfStore, head: CasRef): CasRef | null {
  const node = uwf.store.cas.get(head);
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

  const startNode = uwf.store.cas.get(payload.start);
  if (startNode === null || startNode.type !== uwf.schemas.startNode) {
    return null;
  }

  return (startNode.payload as StartNodePayload).workflow;
}

export async function cmdThreadStart(
  storageRoot: string,
  workflowId: string,
  prompt: string,
  projectRoot: string,
  cwd: string = process.cwd(),
): Promise<StartOutput> {
  // Validate cwd is an absolute path
  if (!isAbsolute(cwd)) {
    fail("cwd must be an absolute path");
  }

  const uwf = await createUwfStore(storageRoot);
  const workflowHash = await resolveWorkflowCasRef(uwf, workflowId, projectRoot);

  const threadId = generateUlid(Date.now()) as ThreadId;
  const plog = createProcessLogger({
    storageRoot,
    context: { thread: threadId, workflow: workflowHash },
  });
  const startPayload: StartNodePayload = {
    workflow: workflowHash,
    prompt,
    cwd,
  };

  const headHash = await uwf.store.cas.put(uwf.schemas.startNode, startPayload);
  const node = uwf.store.cas.get(headHash);
  if (node === null || !validate(uwf.store, node)) {
    fail("stored StartNode failed schema validation");
  }

  setThread(uwf.varStore, threadId, createThreadIndexEntry(headHash));

  plog.log(
    PL_THREAD_START,
    `thread created workflow=${workflowHash} thread=${threadId} head=${headHash}`,
    null,
  );

  return { workflow: workflowHash, thread: threadId };
}

export async function cmdThreadShow(
  storageRoot: string,
  threadId: ThreadId,
): Promise<ThreadShowOutput> {
  const uwf = await createUwfStore(storageRoot);
  const entry = getThread(uwf.varStore, threadId);
  if (entry === null) {
    fail(`thread not found: ${threadId}`);
  }

  const activeHead = entry.head;
  const workflow = resolveWorkflowFromHead(uwf, activeHead);
  if (workflow === null) {
    fail(`failed to resolve workflow from head: ${activeHead}`);
  }

  // Determine if this is a completed/cancelled thread
  if (entry.status === "completed" || entry.status === "cancelled") {
    const hint = null;
    return {
      workflow,
      thread: threadId,
      head: activeHead,
      status: entry.status,
      currentRole: null,
      suspendedRole: null,
      suspendMessage: null,
      done: true,
      background: null,
      hint,
    };
  }

  // Active thread
  const status = await resolveActiveThreadStatus(storageRoot, threadId, uwf, activeHead, workflow);
  const currentRole = resolveCurrentRole(uwf, activeHead, workflow);
  const suspendFields = resolveSuspendFieldsForShow(entry, status, uwf, activeHead, workflow);

  const hint =
    status === "suspended"
      ? `Thread is suspended. Resume with: uwf thread resume ${threadId}`
      : null;

  return {
    workflow,
    thread: threadId,
    head: activeHead,
    status,
    currentRole,
    suspendedRole: suspendFields.suspendedRole,
    suspendMessage: suspendFields.suspendMessage,
    done: false,
    background: null,
    hint,
  };
}

export type ThreadListItemWithStatus = ThreadListItem & {
  status: ThreadStatus;
  currentRole: string | null;
  /** Display label with status marker for suspended threads */
  statusDisplay: string;
};

export type ThreadShowOutput = StepOutput & {
  /** Hint message for suspended threads */
  hint: string | null;
};

async function threadListItemFromActive(
  storageRoot: string,
  uwf: UwfStore,
  threadId: ThreadId,
  head: CasRef,
): Promise<ThreadListItemWithStatus | null> {
  const workflow = resolveWorkflowFromHead(uwf, head);
  if (workflow === null) {
    return null;
  }

  const status = await resolveActiveThreadStatus(storageRoot, threadId, uwf, head, workflow);
  const statusDisplay = status === "suspended" ? `${status} [suspended]` : status;

  return {
    thread: threadId,
    workflow,
    head,
    status,
    currentRole: resolveCurrentRole(uwf, head, workflow),
    statusDisplay,
  };
}

async function collectActiveThreads(
  storageRoot: string,
  uwf: UwfStore,
  index: ThreadsIndex,
): Promise<ThreadListItemWithStatus[]> {
  const items: ThreadListItemWithStatus[] = [];
  for (const [threadId, entry] of Object.entries(index)) {
    const item = await threadListItemFromActive(storageRoot, uwf, threadId as ThreadId, entry.head);
    if (item !== null) {
      items.push(item);
    }
  }
  return items;
}

function collectCompletedThreads(
  uwf: UwfStore,
  activeIds: Set<ThreadId>,
): ThreadListItemWithStatus[] {
  const items: ThreadListItemWithStatus[] = [];
  const history = loadHistoryThreads(uwf.varStore);
  const seen = new Set<ThreadId>(); // Deduplication (issue #470)
  for (const [threadId, entry] of Object.entries(history)) {
    if (!activeIds.has(threadId as ThreadId) && !seen.has(threadId as ThreadId)) {
      seen.add(threadId as ThreadId);
      const status = entry.status;
      const workflow = resolveWorkflowFromHead(uwf, entry.head);
      items.push({
        thread: threadId as ThreadId,
        workflow: workflow ?? "",
        head: entry.head,
        status,
        currentRole: null,
        statusDisplay: status,
      });
    }
  }
  return items;
}

function applyTimeFilters(
  items: ThreadListItemWithStatus[],
  afterMs: number | null,
  beforeMs: number | null,
): ThreadListItemWithStatus[] {
  if (afterMs === null && beforeMs === null) return items;
  return items.filter((item) => {
    const ts = extractUlidTimestamp(item.thread);
    if (ts === null) return false;
    if (afterMs !== null && ts <= afterMs) return false;
    if (beforeMs !== null && ts >= beforeMs) return false;
    return true;
  });
}

function sortByNewestFirst(items: ThreadListItemWithStatus[]): ThreadListItemWithStatus[] {
  return items.sort((a, b) => {
    const tsA = extractUlidTimestamp(a.thread) ?? 0;
    const tsB = extractUlidTimestamp(b.thread) ?? 0;
    return tsB - tsA;
  });
}

function applyPagination(
  items: ThreadListItemWithStatus[],
  skip: number | null,
  take: number | null,
): ThreadListItemWithStatus[] {
  const skipCount = skip ?? 0;
  const takeCount = take ?? items.length;
  return items.slice(skipCount, skipCount + takeCount);
}

export async function cmdThreadList(
  storageRoot: string,
  statusFilter: ThreadStatus[] | null,
  afterMs: number | null,
  beforeMs: number | null,
  skip: number | null,
  take: number | null,
): Promise<ThreadListItemWithStatus[]> {
  const uwf = await createUwfStore(storageRoot);
  const index = loadActiveThreads(uwf.varStore);

  // Collect active threads
  let items = await collectActiveThreads(storageRoot, uwf, index);

  // Collect completed threads (if relevant for status filter)
  const includeCompleted =
    statusFilter === null ||
    statusFilter.includes("completed") ||
    statusFilter.includes("cancelled");
  if (includeCompleted) {
    const activeIds = new Set(items.map((i) => i.thread));
    const completedItems = collectCompletedThreads(uwf, activeIds);
    items = items.concat(completedItems);
  }

  // Apply status filter
  if (statusFilter !== null) {
    items = items.filter((item) => statusFilter.includes(item.status));
  }

  // Apply time range filters
  items = applyTimeFilters(items, afterMs, beforeMs);

  // Sort by timestamp descending (newest first)
  items = sortByNewestFirst(items);

  // Apply pagination
  return applyPagination(items, skip, take);
}

export function extractLastAssistantContent(uwf: UwfStore, detailRef: CasRef): string | null {
  const detailNode = uwf.store.cas.get(detailRef);
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
    const turnNode = uwf.store.cas.get(turnRef as CasRef);
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

function sliceBeforeHash(
  candidates: OrderedStepItem[],
  before: CasRef,
  threadId: ThreadId,
): OrderedStepItem[] {
  const idx = candidates.findIndex((s) => s.hash === before);
  if (idx === -1) {
    fail(`step ${before} not found in thread ${threadId}`);
  }
  return candidates.slice(0, idx);
}

function calculateFormattedStepLength(
  stepNum: number,
  item: OrderedStepItem,
  uwf: UwfStore,
  workflow: WorkflowPayload,
): number {
  // Calculate using the same format as formatStepHeader, formatStepPrompt, formatStepContent
  // Use a temporary set to avoid mutating the actual shownPromptRoles during calculation
  const tempShownRoles = new Set<string>();
  const header = formatStepHeader(stepNum, item);
  const roleDef = workflow.roles[item.payload.role];
  const prompt = formatStepPrompt(roleDef, item.payload.role, tempShownRoles);
  const content = formatStepContent(uwf, item);

  const stepBlock = [header, prompt, content].filter((s) => s !== "").join("");

  // Don't add separator here - it will be counted when we know the final structure
  return stepBlock.length;
}

function selectByQuota(
  candidates: OrderedStepItem[],
  uwf: UwfStore,
  workflow: WorkflowPayload,
  quota: number,
  startSectionLength: number,
): { selected: OrderedStepItem[]; skippedCount: number } {
  const selected: OrderedStepItem[] = [];

  // Start with start section length
  let totalChars = startSectionLength;

  for (let i = candidates.length - 1; i >= 0; i--) {
    const item = candidates[i];
    if (item === undefined) continue;

    // Calculate the actual formatted length using the same format as final output
    const blockLen = calculateFormattedStepLength(i + 1, item, uwf, workflow);

    // Calculate cost of adding this step:
    // - blockLen: the step content
    // - 6: separator before this step (if there are already parts)
    const separatorCost = totalChars > 0 || selected.length > 0 ? 6 : 0;
    const addCost = blockLen + separatorCost;

    // Check quota BEFORE adding - but always include at least one step
    if (totalChars + addCost > quota && selected.length > 0) {
      break;
    }

    selected.unshift(item);
    totalChars += addCost;
  }

  return { selected, skippedCount: candidates.length - selected.length };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSec = Math.round(seconds % 60);
  return `${minutes}m${remainingSec}s`;
}

function formatStepHeader(stepNum: number, item: OrderedStepItem): string {
  const ts = new Date(item.timestamp)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "");
  const durationMs = item.payload.completedAtMs - item.payload.startedAtMs;
  const duration = formatDuration(durationMs);
  return [
    `## Step ${stepNum}: ${item.payload.role} \`${item.hash}\``,
    `**Agent:** ${item.payload.agent} | **Time:** ${ts} | **Duration:** ${duration}`,
  ].join("\n");
}

function formatStepPrompt(
  roleDef: WorkflowPayload["roles"][string] | undefined,
  role: string,
  shownPromptRoles: Set<string>,
): string {
  if (!roleDef || shownPromptRoles.has(role)) return "";
  shownPromptRoles.add(role);
  return ["", "", "<prompt>", roleDef.goal, "</prompt>"].join("\n");
}

function formatStepContent(uwf: UwfStore, item: OrderedStepItem): string {
  if (!item.payload.detail) return "";
  const content = extractLastAssistantContent(uwf, item.payload.detail);
  if (content === null) return "";
  return ["", "", "<output>", content, "</output>"].join("\n");
}

function formatStartSection(options: {
  threadId: ThreadId;
  workflowName: string;
  workflowHash: CasRef;
  prompt: string;
  before: CasRef | null;
  showStart: boolean;
}): string {
  if (options.before !== null && !options.showStart) return "";
  return [
    `# Thread \`${options.threadId}\``,
    "",
    `**Workflow:** ${options.workflowName} (\`${options.workflowHash}\`)`,
    "",
    "## Task",
    "",
    options.prompt,
  ].join("\n");
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
  const { ordered, uwf, workflow, quota, before } = options;

  const candidates = before !== null ? sliceBeforeHash(ordered, before, options.threadId) : ordered;

  // Calculate start section length for quota accounting
  const startSection = formatStartSection(options);
  const startSectionLength = startSection !== "" ? startSection.length : 0;

  const { selected, skippedCount } = selectByQuota(
    candidates,
    uwf,
    workflow,
    quota,
    startSectionLength,
  );

  const parts: string[] = [];

  if (startSection !== "") parts.push(startSection);

  if (skippedCount > 0 && selected.length > 0) {
    const firstSelected = selected[0];
    if (firstSelected !== undefined) {
      parts.push(
        `*(${skippedCount} earlier step${skippedCount > 1 ? "s" : ""}, load with \`uwf thread read ${options.threadId} --before ${firstSelected.hash}\`)*`,
      );
    }
  }

  const startIndex = candidates.length - selected.length;
  const shownPromptRoles = new Set<string>();
  for (let i = 0; i < selected.length; i++) {
    const item = selected[i];
    if (item === undefined) continue;
    const stepNum = startIndex + i + 1;
    const roleDef = workflow.roles[item.payload.role];
    const stepBlock = [
      formatStepHeader(stepNum, item),
      formatStepPrompt(roleDef, item.payload.role, shownPromptRoles),
      formatStepContent(uwf, item),
    ]
      .filter((s) => s !== "")
      .join("");
    parts.push(stepBlock);
  }

  return parts.join("\n\n---\n\n");
}

type EvaluateLastOutput = Record<string, unknown>;

const STATUS_KEY = "$status";

function resolveEvaluateArgs(
  uwf: UwfStore,
  chain: ChainState,
): { lastRole: string; lastOutput: EvaluateLastOutput } {
  if (chain.headIsStart) {
    return { lastRole: START_ROLE, lastOutput: { [STATUS_KEY]: "new" } };
  }

  const lastStep = chain.stepsNewestFirst[0];
  if (lastStep === undefined) {
    fail("empty step chain");
  }

  const raw = expandOutput(uwf, lastStep.output);
  const base =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  return {
    lastRole: lastStep.role,
    lastOutput: base,
  };
}

function loadWorkflowPayload(uwf: UwfStore, workflowRef: CasRef): WorkflowPayload {
  const node = uwf.store.cas.get(workflowRef);
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
    // Try config alias first (e.g. "hermes" → config.agents.hermes),
    // then fall back to raw command name (e.g. "uwf-hermes" or "/usr/bin/agent").
    const fromAlias = config.agents[agentOverride as AgentAlias];
    if (fromAlias !== undefined) {
      return fromAlias;
    }
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

function spawnAgent(
  plog: ProcessLogger,
  agent: AgentConfig,
  threadId: ThreadId,
  role: string,
  edgePrompt: string,
  cwd: string,
): AdapterOutput {
  const argv = [...agent.args, "--thread", threadId, "--role", role, "--prompt", edgePrompt];
  let stdout: string;
  try {
    stdout = execFileSync(agent.command, argv, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024, // 50 MB — stream-json output can be large
      cwd,
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: Buffer | string | null };
    const stderr =
      err.stderr == null
        ? ""
        : typeof err.stderr === "string"
          ? err.stderr
          : err.stderr.toString("utf8");
    const detail = stderr.trim() !== "" ? `: ${stderr.trim()}` : "";
    failStep(plog, `agent command failed (${agent.command})${detail}`);
  }

  const line = stdout.trim().split("\n").pop()?.trim() ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    failStep(plog, `agent stdout last line is not valid JSON: ${line || "(empty)"}`);
  }
  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj !== "object" ||
    obj === null ||
    typeof obj.stepHash !== "string" ||
    !isCasRef(obj.stepHash as string)
  ) {
    failStep(plog, `agent stdout JSON missing valid stepHash: ${line}`);
  }
  return obj as unknown as AdapterOutput;
}

function archiveThread(uwf: UwfStore, threadId: ThreadId, _workflow: CasRef, _head: CasRef): void {
  completeThread(uwf.varStore, threadId, "completed");
}

export async function cmdThreadResume(
  storageRoot: string,
  threadId: ThreadId,
  supplement: string | null,
  agentOverride: string | null,
): Promise<StepOutput> {
  const runningMarker = await isThreadRunning(storageRoot, threadId);
  if (runningMarker !== null) {
    fail(`thread already executing in background (PID: ${runningMarker.pid})`);
  }

  const uwf = await createUwfStore(storageRoot);
  const entry = getThread(uwf.varStore, threadId);
  if (entry === null) {
    fail(`thread not active: ${threadId}`);
  }

  const headHash = entry.head;
  const chain = walkChain(uwf, headHash);
  const workflowHash = chain.start.workflow;

  // Check entry.status first for completed/cancelled (like in cmdThreadShow)
  let status: ThreadStatus;
  if (entry.status === "completed" || entry.status === "cancelled") {
    status = entry.status;
  } else {
    status = await resolveActiveThreadStatus(storageRoot, threadId, uwf, headHash, workflowHash);
  }

  if (status !== "suspended" && status !== "completed") {
    fail(`thread cannot be resumed: ${threadId} (status: ${status})`);
  }

  const plog = createProcessLogger({
    storageRoot,
    context: { thread: threadId, workflow: workflowHash },
  });

  if (status === "suspended") {
    const suspendFields = resolveSuspendFieldsForShow(entry, status, uwf, headHash, workflowHash);
    if (suspendFields.suspendedRole === null) {
      fail(`thread is suspended but suspendedRole is missing: ${threadId}`);
    }
    if (suspendFields.suspendMessage === null) {
      fail(`thread is suspended but suspendMessage is missing: ${threadId}`);
    }

    const resumePrompt = buildResumePrompt(suspendFields.suspendMessage, supplement);

    plog.log(
      PL_THREAD_RESUME,
      `resume role=${suspendFields.suspendedRole} supplement=${supplement !== null}`,
      null,
    );

    return cmdThreadStepOnce(storageRoot, threadId, agentOverride, plog, {
      role: suspendFields.suspendedRole,
      prompt: resumePrompt,
    });
  }

  // status === "completed"
  const workflow = loadWorkflowPayload(uwf, workflowHash);
  const startResult = evaluate(workflow.graph, START_ROLE, { [STATUS_KEY]: "resume" });
  if (!startResult.ok) {
    fail(`failed to evaluate $START: ${startResult.error.message}`);
  }
  if (isSuspendResult(startResult.value)) {
    fail("workflow cannot start with $SUSPEND");
  }
  if (startResult.value.role === END_ROLE) {
    fail("workflow cannot start with $END");
  }

  const startRole = startResult.value.role;
  const completedResumePrompt = buildResumePrompt(startResult.value.prompt, supplement);

  const updatedEntry = { ...entry, status: "idle" as const, completedAt: null };
  setThread(uwf.varStore, threadId, updatedEntry);

  plog.log(
    PL_THREAD_RESUME,
    `resume completed role=${startRole} supplement=${supplement !== null}`,
    null,
  );

  return cmdThreadStepOnce(storageRoot, threadId, agentOverride, plog, {
    role: startRole,
    prompt: completedResumePrompt,
  });
}

export function validateCount(count: number): void {
  if (count < 1 || !Number.isInteger(count)) {
    throw new Error(`--count must be a positive integer, got: ${count}`);
  }
}

export async function cmdThreadExec(
  storageRoot: string,
  threadId: ThreadId,
  agentOverride: string | null,
  count: number,
  background: boolean,
  backgroundWorker: boolean,
): Promise<StepOutput[]> {
  validateCount(count);

  // Check if thread is already running in background (unless we ARE the background worker)
  if (!backgroundWorker) {
    const runningMarker = await isThreadRunning(storageRoot, threadId);
    if (runningMarker !== null) {
      fail(`thread already executing in background (PID: ${runningMarker.pid})`);
    }
  }

  const workflowHash = await resolveActiveThreadWorkflowHash(storageRoot, threadId);
  const plog = createProcessLogger({
    storageRoot,
    context: { thread: threadId, workflow: workflowHash },
  });

  if (background && !backgroundWorker) {
    // Spawn background process
    return cmdThreadStepBackground(storageRoot, threadId, agentOverride, count, plog, workflowHash);
  }

  // If we're the background worker, create marker before execution
  let markerCreated = false;
  if (backgroundWorker) {
    await createMarker(storageRoot, {
      thread: threadId,
      workflow: workflowHash,
      pid: process.pid,
      startedAt: Date.now(),
    });
    markerCreated = true;
  }

  try {
    const results: StepOutput[] = [];
    for (let i = 0; i < count; i++) {
      const result = await cmdThreadStepOnce(storageRoot, threadId, agentOverride, plog);
      results.push(result);
      if (result.done || result.status === "suspended") {
        break;
      }
    }
    return results;
  } finally {
    // Cleanup marker if we created one
    if (markerCreated) {
      await deleteMarker(storageRoot, threadId);
    }
  }
}

async function resolveActiveThreadWorkflowHash(
  storageRoot: string,
  threadId: ThreadId,
): Promise<CasRef> {
  const uwf = await createUwfStore(storageRoot);
  const entry = getThread(uwf.varStore, threadId);
  if (entry === null) {
    fail(`thread not active: ${threadId}`);
  }
  const chain = walkChain(uwf, entry.head);
  return chain.start.workflow;
}

async function cmdThreadStepBackground(
  storageRoot: string,
  threadId: ThreadId,
  agentOverride: string | null,
  count: number,
  plog: ProcessLogger,
  workflowHash: CasRef,
): Promise<StepOutput[]> {
  const uwf = await createUwfStore(storageRoot);
  const entry = getThread(uwf.varStore, threadId);
  if (entry === null) {
    failStep(plog, `thread not active: ${threadId}`);
  }
  const headHash = entry.head;

  // Spawn detached background process
  const scriptPath = process.argv[1];
  if (scriptPath === undefined) {
    failStep(plog, "unable to determine script path for background execution");
  }

  const args = ["thread", "exec", threadId, "--count", String(count)];

  if (agentOverride !== null) {
    args.push("--agent", agentOverride);
  }

  // Internal flag to signal the background worker to create/cleanup markers
  args.push("--_background-worker");

  plog.log(PL_BACKGROUND_START, `spawning background process count=${count}`, null);

  const child = spawn(scriptPath, args, {
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  // Return immediately with current state and background flag
  return [
    {
      workflow: workflowHash,
      thread: threadId,
      head: headHash,
      status: "running",
      currentRole: resolveCurrentRole(uwf, headHash, workflowHash),
      suspendedRole: null,
      suspendMessage: null,
      done: false,
      background: true,
    },
  ];
}

function resolveResumeStepTarget(
  resume: ResumeStepConfig,
  chain: ChainState,
  threadCwd: string,
  plog: ProcessLogger,
): AgentStepTarget {
  const lastStep = chain.stepsNewestFirst[0];
  plog.log(PL_MODERATOR, `resume role=${resume.role} prompt=${resume.prompt}`, null);
  return {
    role: resume.role,
    edgePrompt: resume.prompt,
    effectiveCwd: lastStep !== undefined && lastStep.cwd !== "" ? lastStep.cwd : threadCwd,
  };
}

async function resolveModeratorStepTarget(
  _storageRoot: string,
  threadId: ThreadId,
  entry: ThreadIndexEntry,
  headHash: CasRef,
  workflowHash: CasRef,
  workflow: WorkflowPayload,
  uwf: UwfStore,
  chain: ChainState,
  threadCwd: string,
  plog: ProcessLogger,
): Promise<StepOutput | AgentStepTarget> {
  const { lastRole, lastOutput } = resolveEvaluateArgs(uwf, chain);
  const nextResult = evaluate(workflow.graph, lastRole, lastOutput);
  if (!nextResult.ok) {
    failStep(plog, `moderator evaluate failed: ${nextResult.error.message}`);
  }

  plog.log(
    PL_MODERATOR,
    `moderator ${
      isSuspendResult(nextResult.value)
        ? `action=suspend suspendedRole=${nextResult.value.suspendedRole}`
        : `role=${nextResult.value.role}`
    } prompt=${nextResult.value.prompt}`,
    null,
  );

  if (isSuspendResult(nextResult.value)) {
    await ensureThreadSuspendMetadata(
      uwf.varStore,
      threadId,
      entry,
      nextResult.value.suspendedRole,
      nextResult.value.prompt,
    );
    return buildStepOutputFromEvaluation(
      workflowHash,
      threadId,
      headHash,
      "suspended",
      nextResult,
      null,
    );
  }

  if (nextResult.value.role === END_ROLE) {
    plog.log(PL_THREAD_ARCHIVED, `thread archived head=${headHash}`, null);
    archiveThread(uwf, threadId, workflowHash, headHash);
    return {
      workflow: workflowHash,
      thread: threadId,
      head: headHash,
      status: "completed",
      currentRole: null,
      suspendedRole: null,
      suspendMessage: null,
      done: true,
      background: null,
    };
  }

  return {
    role: nextResult.value.role,
    edgePrompt: nextResult.value.prompt,
    effectiveCwd: nextResult.value.location !== null ? nextResult.value.location : threadCwd,
  };
}

async function finalizeAgentStep(
  _storageRoot: string,
  threadId: ThreadId,
  workflowHash: CasRef,
  workflow: WorkflowPayload,
  newHead: CasRef,
  uwfAfter: UwfStore,
  plog: ProcessLogger,
): Promise<StepOutput> {
  const priorEntry = getThread(uwfAfter.varStore, threadId) ?? createThreadIndexEntry(newHead);
  setThread(uwfAfter.varStore, threadId, updateThreadHead(priorEntry, newHead));

  const chainAfter = walkChain(uwfAfter, newHead);
  const { lastRole: lastRoleAfter, lastOutput: lastOutputAfter } = resolveEvaluateArgs(
    uwfAfter,
    chainAfter,
  );
  const afterResult = evaluate(workflow.graph, lastRoleAfter, lastOutputAfter);
  if (!afterResult.ok) {
    failStep(plog, `post-step moderator evaluate failed: ${afterResult.error.message}`);
  }

  if (isSuspendResult(afterResult.value)) {
    setThread(
      uwfAfter.varStore,
      threadId,
      markThreadSuspended(
        getThread(uwfAfter.varStore, threadId) ?? createThreadIndexEntry(newHead),
        afterResult.value.suspendedRole,
        afterResult.value.prompt,
      ),
    );
    return buildStepOutputFromEvaluation(
      workflowHash,
      threadId,
      newHead,
      "suspended",
      afterResult,
      null,
    );
  }

  const done = afterResult.value.role === END_ROLE;
  if (done) {
    plog.log(PL_THREAD_ARCHIVED, `thread archived head=${newHead}`, null);
    archiveThread(uwfAfter, threadId, workflowHash, newHead);
  }

  const status: ThreadStatus = done ? "completed" : "idle";
  const currentRole = done ? null : afterResult.value.role;

  return {
    workflow: workflowHash,
    thread: threadId,
    head: newHead,
    status,
    currentRole,
    suspendedRole: null,
    suspendMessage: null,
    done,
    background: null,
  };
}

async function cmdThreadStepOnce(
  storageRoot: string,
  threadId: ThreadId,
  agentOverride: string | null,
  plog: ProcessLogger,
  resume: ResumeStepConfig | null = null,
): Promise<StepOutput> {
  const uwf = await createUwfStore(storageRoot);
  const entry = getThread(uwf.varStore, threadId);
  if (entry === null) {
    failStep(plog, `thread not active: ${threadId}`);
  }
  const headHash = entry.head;

  const chain = walkChain(uwf, headHash);
  const workflowHash = chain.start.workflow;
  const workflow = loadWorkflowPayload(uwf, workflowHash);
  const threadCwd = chain.start.cwd;

  const targetOrOutput =
    resume !== null
      ? resolveResumeStepTarget(resume, chain, threadCwd, plog)
      : await resolveModeratorStepTarget(
          storageRoot,
          threadId,
          entry,
          headHash,
          workflowHash,
          workflow,
          uwf,
          chain,
          threadCwd,
          plog,
        );

  if ("status" in targetOrOutput) {
    return targetOrOutput;
  }

  const { role, edgePrompt, effectiveCwd } = targetOrOutput;

  const config = await loadWorkflowConfig(storageRoot);
  const agent = resolveAgentConfig(config, workflow, role, agentOverride);

  plog.log(PL_AGENT_SPAWN, `spawning agent command=${agent.command}`, {
    args: [...agent.args, threadId, role].join(" "),
  });

  loadDotenv({ path: getEnvPath(storageRoot) });
  const agentResult = spawnAgent(plog, agent, threadId, role, edgePrompt, effectiveCwd);
  const newHead = agentResult.stepHash as CasRef;

  plog.log(PL_AGENT_DONE, `agent returned head=${newHead}`, null);

  const uwfAfter = await createUwfStore(storageRoot);
  const newNode = uwfAfter.store.cas.get(newHead);
  if (newNode === null || newNode.type !== uwfAfter.schemas.stepNode) {
    failStep(plog, `agent returned hash that is not a StepNode: ${newHead}`);
  }

  return finalizeAgentStep(storageRoot, threadId, workflowHash, workflow, newHead, uwfAfter, plog);
}

async function resolveHeadHash(storageRoot: string, threadId: ThreadId): Promise<CasRef> {
  const uwf = await createUwfStore(storageRoot);
  const entry = getThread(uwf.varStore, threadId);
  if (entry !== null) {
    return entry.head;
  }
  fail(`thread not found: ${threadId}`);
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

export type StopOutput = {
  thread: ThreadId;
  stopped: boolean;
};

export type CancelOutput = {
  thread: ThreadId;
  cancelled: boolean;
};

/**
 * Stop background execution of a thread (but keep thread active)
 */
export async function cmdThreadStop(storageRoot: string, threadId: ThreadId): Promise<StopOutput> {
  const uwf = await createUwfStore(storageRoot);
  const entry = getThread(uwf.varStore, threadId);
  if (entry === null) {
    fail(`thread not active: ${threadId}`);
  }

  // Check if thread is running in background and terminate it
  const runningMarker = await isThreadRunning(storageRoot, threadId);
  if (runningMarker === null) {
    process.stderr.write(`Warning: thread ${threadId} is not currently running\n`);
    return { thread: threadId, stopped: false };
  }

  try {
    process.kill(runningMarker.pid, "SIGTERM");
  } catch {
    // Process may have already exited, ignore error
  }
  await deleteMarker(storageRoot, threadId);

  return { thread: threadId, stopped: true };
}

/**
 * Cancel a thread (stop execution + move to history)
 */
export async function cmdThreadCancel(
  storageRoot: string,
  threadId: ThreadId,
): Promise<CancelOutput> {
  const uwf = await createUwfStore(storageRoot);
  const entry = getThread(uwf.varStore, threadId);
  if (entry === null) {
    fail(`thread not active: ${threadId}`);
  }

  // Check if thread is running in background and terminate it
  const runningMarker = await isThreadRunning(storageRoot, threadId);
  if (runningMarker !== null) {
    try {
      process.kill(runningMarker.pid, "SIGTERM");
    } catch {
      // Process may have already exited, ignore error
    }
    await deleteMarker(storageRoot, threadId);
  }

  completeThread(uwf.varStore, threadId, "cancelled");

  return { thread: threadId, cancelled: true };
}
