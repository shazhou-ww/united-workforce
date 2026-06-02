// ── 4.1 公共类型 ────────────────────────────────────────────────────

/** CAS hash — XXH64, 13-char Crockford Base32 */
export type CasRef = string;

/** Thread ID — ULID, 26-char Crockford Base32 */
export type ThreadId = string;

/** 一个 step 的核心数据，被 StepNode payload 和 JSONata 上下文共享 */
export type StepRecord = {
  role: string;
  output: CasRef;
  detail: CasRef;
  agent: string;
  /** Moderator edge prompt that led to this step. Missing in legacy nodes → "". */
  edgePrompt: string;
  /** Date.now() before agent spawn */
  startedAtMs: number;
  /** Date.now() after agent returns */
  completedAtMs: number;
  /** Working directory where the agent executed. Missing in legacy nodes → "". */
  cwd: string;
  /** CAS ref to the fully assembled prompt sent to the agent. null for legacy steps. */
  assembledPrompt: CasRef | null;
};

// ── 4.2 Workflow 定义 ───────────────────────────────────────────────

export type RoleDefinition = {
  description: string;
  goal: string;
  capabilities: string[];
  procedure: string;
  output: string;
  frontmatter: CasRef;
};

/** Pseudo-role targets in workflow graph edges (not real roles). */
export type GraphPseudoRole = "$END" | "$SUSPEND";

export type Target = {
  /** Next role name, or a graph pseudo-role such as `$END` or `$SUSPEND`. */
  role: string | GraphPseudoRole;
  prompt: string;
  /** Optional working directory override via mustache template. */
  location: string | null;
};

export type WorkflowPayload = {
  name: string;
  description: string;
  roles: Record<string, RoleDefinition>;
  graph: Record<string, Record<string, Target>>;
};

// ── 4.3 Thread 节点 ─────────────────────────────────────────────────

export type StartNodePayload = {
  workflow: CasRef;
  prompt: string;
  /** Working directory where the thread was created. */
  cwd: string;
};

export type StepNodePayload = StepRecord & {
  start: CasRef;
  prev: CasRef | null;
};

// ── 4.4 JSONata 求值上下文 ──────────────────────────────────────────

/** JSONata 上下文中的 step — output 被展开 */
export type StepContext = Omit<StepRecord, "output"> & {
  output: unknown;
  content: string | null;
};

export type ModeratorContext = {
  start: StartNodePayload;
  steps: StepContext[];
};

// ── 4.5 CLI 输出 ────────────────────────────────────────────────────

/** Thread status — unified status representation */
export type ThreadStatus = "idle" | "running" | "suspended" | "completed" | "cancelled";

/** uwf thread start */
export type StartOutput = {
  workflow: CasRef;
  thread: ThreadId;
};

/**
 * Output from thread show and thread exec commands.
 *
 * @property status - Current thread status (idle/running/suspended/completed/cancelled)
 * @property done - @deprecated Use status field instead. True if thread is completed or cancelled.
 * @property background - @deprecated Use status field instead. Always null in current implementation.
 */
export type StepOutput = {
  workflow: CasRef;
  thread: ThreadId;
  head: CasRef;
  status: ThreadStatus;
  /** The current or next role. Null when completed, cancelled, suspended, or next is $END. */
  currentRole: string | null;
  done: boolean;
  background: boolean | null;
};

/** uwf thread steps — single step entry */
export type StepEntry = {
  hash: CasRef;
  role: string;
  output: unknown;
  detail: CasRef;
  agent: string;
  timestamp: number;
  durationMs: number;
};

/** uwf thread steps — start entry */
export type StartEntry = {
  hash: CasRef;
  workflow: CasRef;
  prompt: string;
  timestamp: number;
};

/** uwf thread steps output */
export type ThreadStepsOutput = {
  thread: ThreadId;
  workflow: CasRef;
  steps: [StartEntry, ...StepEntry[]];
};

/** uwf thread fork output */
export type ThreadForkOutput = {
  thread: ThreadId;
  forkedFrom: {
    step: CasRef;
  };
};

/** uwf thread list */
export type ThreadListItem = {
  thread: ThreadId;
  workflow: CasRef;
  head: CasRef;
};

/** uwf thread running — single running thread entry */
export type RunningThreadItem = {
  thread: ThreadId;
  workflow: CasRef;
  pid: number;
  startedAt: number;
};

/** uwf thread running output */
export type RunningThreadsOutput = {
  threads: RunningThreadItem[];
};

// ── 4.6 配置 ────────────────────────────────────────────────────────

/** Alias types for config references */
export type AgentAlias = string;
export type ModelAlias = string;
export type ProviderAlias = string;
export type WorkflowName = string;
export type RoleName = string;
export type Scenario = string;

export type ProviderConfig = {
  baseUrl: string;
  apiKey: string;
};

export type ModelConfig = {
  provider: ProviderAlias;
  name: string;
};

export type AgentConfig = {
  command: string;
  args: string[];
};

/** ~/.uncaged/workflow/config.yaml */
export type WorkflowConfig = {
  providers: Record<ProviderAlias, ProviderConfig>;
  models: Record<ModelAlias, ModelConfig>;
  agents: Record<AgentAlias, AgentConfig>;
  defaultAgent: AgentAlias;
  agentOverrides: Record<WorkflowName, Record<RoleName, AgentAlias>> | null;
  defaultModel: ModelAlias;
  modelOverrides: Record<Scenario, ModelAlias> | null;
};

/** ~/.uncaged/workflow/threads.yaml */
export type ThreadsIndex = Record<ThreadId, CasRef>;
