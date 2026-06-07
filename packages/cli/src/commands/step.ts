import { execFileSync } from "node:child_process";
import type { CasStore } from "@ocas/core";
import type {
  AgentAlias,
  AgentConfig,
  CasRef,
  StartEntry,
  StepEntry,
  StepNodePayload,
  ThreadForkOutput,
  ThreadId,
  ThreadStepsOutput,
  WorkflowConfig,
  WorkflowPayload,
} from "@united-workforce/protocol";
import { generateUlid } from "@united-workforce/util";
import { getAskSessionId, loadWorkflowConfig, setAskSessionId } from "@united-workforce/util-agent";
import { createUwfStore, setThread, type UwfStore } from "../store.js";
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

  const startNode = uwf.store.cas.get(chain.startHash);
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
      usage: item.payload.usage ?? null,
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
  const node = uwf.store.cas.get(stepHash);
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
  const node = uwf.store.cas.get(stepHash);
  if (node === null) {
    fail(`CAS node not found: ${stepHash}`);
  }
  if (node.type !== uwf.schemas.startNode && node.type !== uwf.schemas.stepNode) {
    fail(`node ${stepHash} is not a StartNode or StepNode`);
  }

  const newThreadId = generateUlid(Date.now()) as ThreadId;
  setThread(uwf.varStore, newThreadId, {
    head: stepHash,
    status: "idle",
    suspendedRole: null,
    suspendMessage: null,
    completedAt: null,
  });

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
function loadStepDetail(store: CasStore, detailRef: CasRef): Record<string, unknown> {
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
  store: CasStore,
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
function loadTurnData(store: CasStore, turns: unknown): TurnData[] {
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
  showPrompt: boolean,
): Promise<string> {
  const uwf = await createUwfStore(storageRoot);
  const node = uwf.store.cas.get(stepHash);
  if (node === null) {
    fail(`CAS node not found: ${stepHash}`);
  }
  if (node.type !== uwf.schemas.stepNode) {
    fail(`node ${stepHash} is not a StepNode`);
  }
  const payload = node.payload as StepNodePayload;

  // --prompt mode: show the assembled prompt that was sent to the agent
  if (showPrompt) {
    const promptRef = (payload as Record<string, unknown>).assembledPrompt;
    if (typeof promptRef !== "string") {
      return `# Step ${stepHash}\n\n_Prompt not recorded (legacy step)._`;
    }
    const promptNode = uwf.store.cas.get(promptRef as CasRef);
    if (promptNode === null) {
      return `# Step ${stepHash}\n\n_Prompt CAS node not found: ${promptRef}_`;
    }
    const promptText =
      typeof promptNode.payload === "string"
        ? promptNode.payload
        : JSON.stringify(promptNode.payload);
    return `# Step ${stepHash}\n\n**Role:** ${payload.role}\n**Agent:** ${payload.agent}\n\n## Prompt\n\n${promptText}`;
  }

  if (payload.detail === null) {
    return formatStepMarkdown(stepHash, payload.role, payload.agent, [], []);
  }

  const detail = loadStepDetail(uwf.store.cas, payload.detail);
  const turnData = loadTurnData(uwf.store.cas, detail.turns);

  if (turnData.length === 0) {
    return formatStepMarkdown(stepHash, payload.role, payload.agent, [], []);
  }

  const headerSection = formatStepMarkdown(stepHash, payload.role, payload.agent, [], []);
  const BUFFER = 200;
  const availableQuota = quota - headerSection.length - BUFFER;
  const selectedTurns = selectTurnsForQuota(turnData, availableQuota);

  return formatStepMarkdown(stepHash, payload.role, payload.agent, turnData, selectedTurns);
}

// ── step ask ────────────────────────────────────────────────────────────────

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

function resolveAskAgentConfig(
  config: WorkflowConfig,
  workflow: WorkflowPayload | null,
  role: string,
  agentOverride: string | null,
  recordedAgent: string,
): AgentConfig {
  if (agentOverride !== null) {
    const fromAlias = config.agents[agentOverride as AgentAlias];
    if (fromAlias !== undefined) {
      return fromAlias;
    }
    return parseAgentOverride(agentOverride);
  }

  // Try to resolve via the recorded agent name as a config alias.
  const fromRecorded = config.agents[recordedAgent as AgentAlias];
  if (fromRecorded !== undefined) {
    return fromRecorded;
  }

  // Fall back to default agent for the workflow / role.
  if (workflow !== null && config.agentOverrides !== null) {
    const roleOverrides = config.agentOverrides[workflow.name];
    if (roleOverrides !== undefined && roleOverrides[role] !== undefined) {
      const alias = roleOverrides[role];
      const agentConfig = config.agents[alias];
      if (agentConfig !== undefined) {
        return agentConfig;
      }
    }
  }

  // Treat the recorded value as a raw command path.
  return parseAgentOverride(recordedAgent);
}

/**
 * Derive the agent name used for cache file partitioning from an executable
 * path or alias.  Examples:
 *   uwf-hermes        → hermes
 *   uwf-claude-code   → claude-code
 *   /tmp/mock-agent.sh → mock
 *   /usr/bin/agent    → agent
 */
function deriveAgentName(commandPath: string): string {
  const basename = commandPath.split(/[/\\]/).pop() ?? commandPath;
  // Strip a trailing extension (.sh, .js, .mjs, .cjs)
  const noExt = basename.replace(/\.(sh|js|mjs|cjs|ts)$/i, "");
  // Strip the `uwf-` prefix introduced by agentLabel().
  const noPrefix = noExt.startsWith("uwf-") ? noExt.slice(4) : noExt;
  // Strip the trailing `-agent` suffix used by tests / generic agent shells.
  const noSuffix = noPrefix.endsWith("-agent") ? noPrefix.slice(0, -"-agent".length) : noPrefix;
  return noSuffix === "" ? noExt : noSuffix;
}

function loadDetailNode(
  store: CasStore,
  detailRef: CasRef,
): { sessionId: string | null; payload: Record<string, unknown> } {
  const detailNode = store.get(detailRef);
  if (detailNode === null) {
    fail(`detail node not found: ${detailRef}`);
  }
  const payload = detailNode.payload as Record<string, unknown>;
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : null;
  return { sessionId, payload };
}

function spawnAskAgent(agent: AgentConfig, argv: string[], cwd: string): { stdout: string } {
  try {
    const stdout = execFileSync(agent.command, [...agent.args, ...argv], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024,
      cwd,
    });
    return { stdout };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr: Buffer | string | null };
    if (err.code === "ENOENT") {
      fail(
        `"${agent.command}" not found in PATH. Install it or check your PATH config. Run: which ${agent.command}`,
      );
    }
    const stderr =
      err.stderr == null
        ? ""
        : typeof err.stderr === "string"
          ? err.stderr
          : err.stderr.toString("utf8");
    const detail = stderr.trim() !== "" ? `: ${stderr.trim()}` : "";
    fail(`agent command failed (${agent.command})${detail}`);
  }
}

function resolveAskWorkflow(uwf: UwfStore, payload: StepNodePayload): WorkflowPayload | null {
  const startNode = uwf.store.cas.get(payload.start);
  if (startNode === null) {
    return null;
  }
  const start = startNode.payload as { workflow: CasRef };
  const workflowNode = uwf.store.cas.get(start.workflow);
  if (workflowNode === null) {
    return null;
  }
  return workflowNode.payload as WorkflowPayload;
}

async function performFork(
  agent: AgentConfig,
  agentName: string,
  stepHash: CasRef,
  sourceSessionId: string,
  storageRoot: string,
  cwd: string,
): Promise<string> {
  const cached = await getAskSessionId(agentName, stepHash, storageRoot);
  if (cached !== null) {
    return cached;
  }
  const { stdout } = spawnAskAgent(agent, ["--mode", "fork", "--session", sourceSessionId], cwd);
  const newSessionId = stdout.trim().split("\n").pop()?.trim() ?? "";
  if (newSessionId === "") {
    fail(`agent fork did not return a session id (${agent.command})`);
  }
  await setAskSessionId(agentName, stepHash, newSessionId, storageRoot);
  return newSessionId;
}

export type CmdStepAskOptions = {
  prompt: string;
  agentOverride: string | null;
  /** When false, skip session forking and pass detail ref for context injection. */
  fork: boolean;
};

/**
 * Ask a follow-up question to a historical step's agent (read-only).
 *
 * Does NOT write a new StepNode and does NOT mutate thread state.  The agent's
 * raw stdout is returned so the CLI entry point can stream it directly.
 */
export async function cmdStepAsk(
  storageRoot: string,
  stepHash: CasRef,
  options: CmdStepAskOptions,
): Promise<string> {
  const uwf = await createUwfStore(storageRoot);
  const node = uwf.store.cas.get(stepHash);
  if (node === null) {
    fail(`CAS node not found: ${stepHash}`);
  }
  if (node.type !== uwf.schemas.stepNode) {
    fail(`node ${stepHash} is not a StepNode`);
  }
  const payload = node.payload as StepNodePayload;
  if (payload.detail === null) {
    fail(`step ${stepHash} has no detail; cannot ask`);
  }

  const detailRef = payload.detail;
  const { sessionId: sourceSessionId } = loadDetailNode(uwf.store.cas, detailRef);

  const workflow = resolveAskWorkflow(uwf, payload);
  const config = await loadWorkflowConfig(storageRoot);
  const agent = resolveAskAgentConfig(
    config,
    workflow,
    payload.role,
    options.agentOverride,
    payload.agent,
  );
  const agentName = deriveAgentName(agent.command);

  const cwd = payload.cwd !== "" ? payload.cwd : process.cwd();

  // Fork path: fork (or reuse cached fork) → ask with that session.
  if (options.fork && sourceSessionId !== null) {
    const askSessionId = await performFork(
      agent,
      agentName,
      stepHash,
      sourceSessionId,
      storageRoot,
      cwd,
    );
    const argv = ["--mode", "ask", "--session", askSessionId, "--prompt", options.prompt];
    argv.push("--detail", detailRef);
    const { stdout } = spawnAskAgent(agent, argv, cwd);
    return stdout;
  }

  // Fallback path: ask without forking; inject detail ref for context.
  const argv = ["--mode", "ask", "--prompt", options.prompt];
  argv.push("--detail", detailRef);
  const { stdout } = spawnAskAgent(agent, argv, cwd);
  return stdout;
}
