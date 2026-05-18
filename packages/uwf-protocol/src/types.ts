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
};

// ── 4.2 Workflow 定义 ───────────────────────────────────────────────

export type RoleDefinition = {
  description: string;
  systemPrompt: string;
  outputSchema: CasRef;
};

export type Transition = {
  role: string;
  condition: string | null;
};

export type ConditionDefinition = {
  description: string;
  expression: string;
};

export type WorkflowPayload = {
  name: string;
  description: string;
  roles: Record<string, RoleDefinition>;
  conditions: Record<string, ConditionDefinition>;
  graph: Record<string, Transition[]>;
};

// ── 4.3 Thread 节点 ─────────────────────────────────────────────────

export type StartNodePayload = {
  workflow: CasRef;
  prompt: string;
};

export type StepNodePayload = StepRecord & {
  start: CasRef;
  prev: CasRef | null;
};

// ── 4.4 JSONata 求值上下文 ──────────────────────────────────────────

/** JSONata 上下文中的 step — output 被展开 */
export type StepContext = Omit<StepRecord, "output"> & {
  output: unknown;
};

export type ModeratorContext = {
  start: StartNodePayload;
  steps: StepContext[];
};

// ── 4.5 CLI 输出 ────────────────────────────────────────────────────

/** uwf thread start */
export type StartOutput = {
  workflow: CasRef;
  thread: ThreadId;
};

/** uwf thread step / uwf thread show */
export type StepOutput = {
  workflow: CasRef;
  thread: ThreadId;
  head: CasRef;
  done: boolean;
};

/** uwf thread steps — single step entry */
export type StepEntry = {
  hash: CasRef;
  role: string;
  output: unknown;
  detail: CasRef;
  agent: string;
  timestamp: number;
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
    thread: ThreadId;
    step: CasRef;
  };
};

/** uwf thread list */
export type ThreadListItem = {
  thread: ThreadId;
  workflow: CasRef;
  head: CasRef;
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
  apiKeyEnv: string;
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
