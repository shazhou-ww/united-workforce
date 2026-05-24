import { execFileSync, spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import type { Store as CasStore, JSONSchema } from "@uncaged/json-cas";
import { getSchema, validate } from "@uncaged/json-cas";
import { getEnvPath, loadWorkflowConfig } from "@uncaged/workflow-agent-kit";
import { evaluate } from "@uncaged/workflow-moderator";
import type {
  AgentAlias,
  AgentConfig,
  CasRef,
  ModeratorContext,
  RunningThreadsOutput,
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
import { createProcessLogger, generateUlid, type ProcessLogger } from "@uncaged/workflow-util";
import { config as loadDotenv } from "dotenv";
import { parse, stringify } from "yaml";
import {
  createMarker,
  deleteMarker,
  isThreadRunning,
  listRunningThreads,
} from "../background/index.js";
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
import { checkWorkflowFilenameConsistency, isCasRef, parseWorkflowPayload } from "../validate.js";
import { materializeWorkflowPayload } from "./workflow.js";

const END_ROLE = "$END";
export const THREAD_READ_DEFAULT_QUOTA = 4000;

const PL_THREAD_START = "7HNQ4B2X";
const PL_MODERATOR = "M3K8V9T1";
const PL_AGENT_SPAWN = "R5J2W8N4";
const PL_AGENT_DONE = "C6P9E3H7";
const PL_THREAD_ARCHIVED = "F4D8Q2K5";
const PL_STEP_ERROR = "B8T5N1V6";
const PL_BACKGROUND_START = "X7Q4W9M2";

function failStep(plog: ProcessLogger, message: string): never {
  plog.log(PL_STEP_ERROR, message, null);
  fail(message);
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

export type KillOutput = {
  thread: ThreadId;
  archived: boolean;
};

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
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

  // Check .workflows/ directory as fallback (legacy)
  for (const ext of [".yaml", ".yml"]) {
    const result = await workflowFileExists(resolvePath(dir, ".workflows"), name, ext);
    if (result !== null) {
      return result;
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
    raw = parse(text) as unknown;
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

  const materialized = await materializeWorkflowPayload(uwf, payload);
  const hash = await uwf.store.put(uwf.schemas.workflow, materialized);
  const stored = uwf.store.get(hash);
  if (stored === null || !validate(uwf.store, stored)) {
    fail("stored local workflow failed schema validation");
  }

  return hash;
}

async function resolveWorkflowCasRef(
  uwf: UwfStore,
  storageRoot: string,
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
    const node = uwf.store.get(trimmed);
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
  const registry = await loadWorkflowRegistry(storageRoot);
  const hash = resolveWorkflowHash(registry, trimmed);
  if (!isCasRef(hash)) {
    fail(`workflow not found: ${trimmed}`);
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
  projectRoot: string,
): Promise<StartOutput> {
  const uwf = await createUwfStore(storageRoot);
  const workflowHash = await resolveWorkflowCasRef(uwf, storageRoot, workflowId, projectRoot);

  const threadId = generateUlid(Date.now()) as ThreadId;
  const plog = createProcessLogger({
    storageRoot,
    context: { thread: threadId, workflow: workflowHash },
  });
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

  plog.log(
    PL_THREAD_START,
    `thread created workflow=${workflowHash} thread=${threadId} head=${headHash}`,
    null,
  );

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
      background: null,
    };
  }

  const hist = await findThreadInHistory(storageRoot, threadId);
  if (hist !== null) {
    return {
      workflow: hist.workflow,
      thread: threadId,
      head: hist.head,
      done: true,
      background: null,
    };
  }

  fail(`thread not found: ${threadId}`);
}

export type ThreadStatus = "idle" | "running" | "completed";

export type ThreadListItemWithStatus = ThreadListItem & {
  status: ThreadStatus;
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

  // Check if thread is currently running in background
  const runningMarker = await isThreadRunning(storageRoot, threadId);
  const status: ThreadStatus = runningMarker !== null ? "running" : "idle";

  return { thread: threadId, workflow, head, status };
}

export async function cmdThreadList(
  storageRoot: string,
  statusFilter: ThreadStatus | null,
): Promise<ThreadListItemWithStatus[]> {
  const uwf = await createUwfStore(storageRoot);
  const index = await loadThreadsIndex(storageRoot);
  const items: ThreadListItemWithStatus[] = [];

  // Add active threads
  for (const [threadId, head] of Object.entries(index)) {
    const item = await threadListItemFromActive(storageRoot, uwf, threadId as ThreadId, head);
    if (item !== null) {
      items.push(item);
    }
  }

  // Add completed threads if requested
  if (statusFilter === "completed" || statusFilter === null) {
    const activeIds = new Set(items.map((i) => i.thread));
    const history = await loadThreadHistory(storageRoot);
    for (const entry of history) {
      if (!activeIds.has(entry.thread)) {
        items.push({
          thread: entry.thread,
          workflow: entry.workflow,
          head: entry.head,
          status: "completed",
        });
      }
    }
  }

  // Apply status filter if provided
  if (statusFilter !== null) {
    return items.filter((item) => item.status === statusFilter);
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
  if (!schema.items || !Array.isArray(value)) return value;
  const itemSchema = schema.items as JSONSchema;
  return (value as unknown[]).map((item) => expandValue(store, itemSchema, item, visited));
}

function expandObjectField(
  store: CasStore,
  schema: JSONSchema,
  value: unknown,
  visited: Set<string>,
): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value) || !schema.properties) {
    return value;
  }
  const props = schema.properties as Record<string, JSONSchema>;
  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const propSchema = props[key];
    result[key] = propSchema ? expandValue(store, propSchema, val, visited) : val;
  }
  return result;
}

function expandValue(
  store: CasStore,
  schema: JSONSchema,
  value: unknown,
  visited: Set<string>,
): unknown {
  if (schema.format === "cas_ref") return expandCasRefField(store, value, visited);
  if (Array.isArray(schema.anyOf)) return expandAnyOfField(store, schema, value, visited);
  if (schema.type === "array") return expandArrayField(store, schema, value, visited);
  return expandObjectField(store, schema, value, visited);
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
  return stringify(value, { aliasDuplicateObjects: false }).trimEnd();
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

function selectByQuota(
  candidates: OrderedStepItem[],
  uwf: UwfStore,
  quota: number,
): { selected: OrderedStepItem[]; skippedCount: number } {
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
  return { selected, skippedCount: candidates.length - selected.length };
}

function formatStepHeader(stepNum: number, item: OrderedStepItem): string {
  const ts = new Date(item.timestamp)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "");
  return [
    `## Step ${stepNum}: ${item.payload.role} \`${item.hash}\``,
    `**Agent:** ${item.payload.agent} | **Time:** ${ts}`,
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
  const { selected, skippedCount } = selectByQuota(candidates, uwf, quota);

  const parts: string[] = [];

  const startSection = formatStartSection(options);
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

function buildModeratorContext(uwf: UwfStore, chain: ChainState): ModeratorContext {
  const chronological = [...chain.stepsNewestFirst].reverse();
  const steps: StepContext[] = chronological.map((step) => ({
    role: step.role,
    output: expandOutput(uwf, step.output),
    detail: step.detail,
    agent: step.agent,
    edgePrompt: step.edgePrompt ?? "",
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

function spawnAgent(
  plog: ProcessLogger,
  agent: AgentConfig,
  threadId: ThreadId,
  role: string,
  edgePrompt: string,
): CasRef {
  const argv = [...agent.args, "--thread", threadId, "--role", role, "--prompt", edgePrompt];
  let stdout: string;
  try {
    stdout = execFileSync(agent.command, argv, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024, // 50 MB — stream-json output can be large
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
  if (!isCasRef(line)) {
    failStep(plog, `agent stdout is not a valid CAS hash: ${line || "(empty)"}`);
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

export async function cmdThreadExec(
  storageRoot: string,
  threadId: ThreadId,
  agentOverride: string | null,
  count: number,
  background: boolean,
  backgroundWorker: boolean,
): Promise<StepOutput[]> {
  if (count < 1 || !Number.isInteger(count)) {
    fail(`--count must be a positive integer, got: ${count}`);
  }

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
      if (result.done) {
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
  const index = await loadThreadsIndex(storageRoot);
  const headHash = index[threadId];
  if (headHash === undefined) {
    fail(`thread not active: ${threadId}`);
  }
  const uwf = await createUwfStore(storageRoot);
  const chain = walkChain(uwf, headHash);
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
  // Get current head to return to caller
  const index = await loadThreadsIndex(storageRoot);
  const headHash = index[threadId];
  if (headHash === undefined) {
    failStep(plog, `thread not active: ${threadId}`);
  }

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
      done: false,
      background: true,
    },
  ];
}

async function cmdThreadStepOnce(
  storageRoot: string,
  threadId: ThreadId,
  agentOverride: string | null,
  plog: ProcessLogger,
): Promise<StepOutput> {
  const index = await loadThreadsIndex(storageRoot);
  const headHash = index[threadId];
  if (headHash === undefined) {
    failStep(plog, `thread not active: ${threadId}`);
  }

  const uwf = await createUwfStore(storageRoot);
  const chain = walkChain(uwf, headHash);
  const workflowHash = chain.start.workflow;
  const workflow = loadWorkflowPayload(uwf, workflowHash);
  const context = buildModeratorContext(uwf, chain);

  const nextResult = await evaluate(workflow, context);
  if (!nextResult.ok) {
    failStep(plog, `moderator evaluate failed: ${nextResult.error.message}`);
  }

  plog.log(
    PL_MODERATOR,
    `moderator role=${nextResult.value.role} prompt=${nextResult.value.prompt}`,
    null,
  );

  if (nextResult.value.role === END_ROLE) {
    plog.log(PL_THREAD_ARCHIVED, `thread archived head=${headHash}`, null);
    await archiveThread(storageRoot, threadId, workflowHash, headHash);
    return {
      workflow: workflowHash,
      thread: threadId,
      head: headHash,
      done: true,
      background: null,
    };
  }

  const role = nextResult.value.role;
  const edgePrompt = nextResult.value.prompt;
  const config = await loadWorkflowConfig(storageRoot);
  const agent = resolveAgentConfig(config, workflow, role, agentOverride);

  plog.log(PL_AGENT_SPAWN, `spawning agent command=${agent.command}`, {
    args: [...agent.args, threadId, role].join(" "),
  });

  loadDotenv({ path: getEnvPath(storageRoot) });
  const newHead = spawnAgent(plog, agent, threadId, role, edgePrompt);

  plog.log(PL_AGENT_DONE, `agent returned head=${newHead}`, null);

  // Re-create store to pick up nodes written by the agent subprocess
  const uwfAfter = await createUwfStore(storageRoot);
  const newNode = uwfAfter.store.get(newHead);
  if (newNode === null || newNode.type !== uwfAfter.schemas.stepNode) {
    failStep(plog, `agent returned hash that is not a StepNode: ${newHead}`);
  }

  // Reload threads index to avoid overwriting changes made by the agent subprocess
  const freshIndex = await loadThreadsIndex(storageRoot);
  freshIndex[threadId] = newHead;
  await saveThreadsIndex(storageRoot, freshIndex);

  const chainAfter = walkChain(uwfAfter, newHead);
  const contextAfter = buildModeratorContext(uwfAfter, chainAfter);
  const afterResult = await evaluate(workflow, contextAfter);
  if (!afterResult.ok) {
    failStep(plog, `post-step moderator evaluate failed: ${afterResult.error.message}`);
  }

  const done = afterResult.value.role === END_ROLE;
  if (done) {
    plog.log(PL_THREAD_ARCHIVED, `thread archived head=${newHead}`, null);
    await archiveThread(storageRoot, threadId, workflowHash, newHead);
  }

  return {
    workflow: workflowHash,
    thread: threadId,
    head: newHead,
    done,
    background: null,
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
  const index = await loadThreadsIndex(storageRoot);
  const head = index[threadId];
  if (head === undefined) {
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
  const index = await loadThreadsIndex(storageRoot);
  const head = index[threadId];
  if (head === undefined) {
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

  return { thread: threadId, cancelled: true };
}

export async function cmdThreadKill(storageRoot: string, threadId: ThreadId): Promise<KillOutput> {
  const index = await loadThreadsIndex(storageRoot);
  const head = index[threadId];
  if (head === undefined) {
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

export async function cmdThreadRunning(storageRoot: string): Promise<RunningThreadsOutput> {
  const threads = await listRunningThreads(storageRoot);
  return { threads };
}
