import type * as z from "zod/v4";

// ── Constants ──────────────────────────────────────────────────────

export const START = "__start__" as const;
export const END = "__end__" as const;

// ── Result ─────────────────────────────────────────────────────────

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

// ── CAS ────────────────────────────────────────────────────────────

export type CasStore = {
  put(content: string): Promise<string>;
  get(hash: string): Promise<string | null>;
  delete(hash: string): Promise<void>;
  list(): Promise<string[]>;
};

// ── Workflow Descriptor ────────────────────────────────────────────

export type WorkflowRoleSchema = Record<string, unknown>;

export type WorkflowRoleDescriptor = {
  description: string;
  schema: WorkflowRoleSchema;
};

export type WorkflowDescriptor = {
  description: string;
  roles: Record<string, WorkflowRoleDescriptor>;
};

// ── Role & Thread ──────────────────────────────────────────────────

export type RoleMeta = Record<string, Record<string, unknown>>;

export type RoleOutput = {
  role: string;
  contentHash: string;
  meta: Record<string, unknown>;
  refs: string[];
};

export type StartStep = {
  role: typeof START;
  content: string;
  meta: Record<string, never>;
  timestamp: number;
};

export type RoleStep<M extends RoleMeta> = {
  [K in keyof M & string]: {
    role: K;
    meta: M[K];
    contentHash: string;
    refs: string[];
    timestamp: number;
  };
}[keyof M & string];

export type ThreadContext<M extends RoleMeta = RoleMeta> = {
  threadId: string;
  depth: number;
  start: StartStep;
  steps: RoleStep<M>[];
};

export type ModeratorContext<M extends RoleMeta = RoleMeta> = ThreadContext<M>;

export type AgentContext<M extends RoleMeta = RoleMeta> = ModeratorContext<M> & {
  currentRole: {
    name: string;
    systemPrompt: string;
  };
};

// ── Workflow Completion ────────────────────────────────────────────

export type WorkflowCompletion = {
  returnCode: number;
  summary: string;
};

export type WorkflowResult = WorkflowCompletion & {
  rootHash: string;
};

// ── LLM Provider ───────────────────────────────────────────────────

export type LlmProvider = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type ProviderConfig = {
  baseUrl: string;
  apiKey: string;
};

export type ResolvedModel = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type WorkflowConfig = {
  maxDepth: number;
  supervisorInterval: number;
  providers: Record<string, ProviderConfig>;
  models: Record<string, string>;
};

// ── Functions ──────────────────────────────────────────────────────

/** Structured output of the extract phase (RFC v3 content Merkle + artifact refs). */
export type ExtractResult<T extends Record<string, unknown>> = {
  meta: T;
  contentPayload: string;
  refs: string[];
};

export type ExtractFn = <T extends Record<string, unknown>>(
  schema: z.ZodType<T>,
  contentHash: string,
) => Promise<ExtractResult<T>>;

export type AgentFn = (ctx: AgentContext) => Promise<string>;

export type AgentBinding = {
  agent: AgentFn;
  overrides: Partial<Record<string, AgentFn>> | null;
};

// ── Workflow Runtime & Definition ──────────────────────────────────

export type WorkflowRuntime = {
  cas: CasStore;
  extract: ExtractFn;
};

export type WorkflowFn = (
  thread: ThreadContext,
  runtime: WorkflowRuntime,
) => AsyncGenerator<RoleOutput, WorkflowCompletion>;

export type RoleDefinition<Meta extends Record<string, unknown>> = {
  description: string;
  systemPrompt: string;
  schema: z.ZodType<Meta>;
  extractRefs: ((meta: Meta) => string[]) | null;
};

export type Moderator<M extends RoleMeta> = (
  ctx: ModeratorContext<M>,
) => (keyof M & string) | typeof END;

export type WorkflowDefinition<M extends RoleMeta> = {
  description: string;
  roles: { [K in keyof M & string]: RoleDefinition<M[K]> };
  moderator: Moderator<M>;
};

// ── Declarative Moderator Table ────────────────────────────────────

export type ModeratorCondition<M extends RoleMeta> = {
  name: string;
  description: string;
  check: (ctx: ModeratorContext<M>) => boolean;
};

export type FALLBACK = "FALLBACK";

export type ModeratorTransition<M extends RoleMeta> = {
  condition: ModeratorCondition<M> | FALLBACK;
  role: (keyof M & string) | typeof END;
};

export type ModeratorTable<M extends RoleMeta> = Record<
  (keyof M & string) | typeof START,
  ModeratorTransition<M>[]
>;

// ── Advance Outcome ────────────────────────────────────────────────

export type AdvanceOutcome<M extends RoleMeta> =
  | { kind: "complete"; completion: WorkflowCompletion }
  | { kind: "yield"; output: RoleOutput; step: RoleStep<M> };
