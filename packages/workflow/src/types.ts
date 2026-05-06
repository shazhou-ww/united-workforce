import type * as z from "zod/v4";

/** Sentinel values for automaton control flow. */
export const START = "__start__" as const;
export const END = "__end__" as const;

/** Maps role names → their meta types. Single generic drives all inference. */
export type RoleMeta = Record<string, Record<string, unknown>>;

/** OpenAI-compatible LLM endpoint used for structured meta extraction. */
export type LlmProvider = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

/** What each generator yield produces — one role's output (engine adds `timestamp` when persisting). */
export type RoleOutput = {
  role: string;
  content: string;
  meta: Record<string, unknown>;
};

/** What the workflow AsyncGenerator returns when done. */
export type WorkflowResult = {
  returnCode: number;
  summary: string;
};

/** Input to a workflow — prompt plus optional historical steps for fork/resume. */
export type ThreadInput = {
  prompt: string;
  steps: RoleOutput[];
};

/** Options passed to a workflow bundle's `run` export (engine-provided). */
export type WorkflowFnOptions = {
  threadId: string;
  isDryRun: boolean;
  maxRounds: number;
};

/** Bundle contract — named export `run` is a function returning an AsyncGenerator. */
export type WorkflowFn = (
  input: ThreadInput,
  options: WorkflowFnOptions,
) => AsyncGenerator<RoleOutput, WorkflowResult>;

/** Engine start frame: initial prompt + thread identity. */
export type StartStep = {
  role: typeof START;
  content: string;
  meta: { maxRounds: number };
  timestamp: number;
};

/** A completed role step in the thread. */
export type RoleStep<M extends RoleMeta> = {
  [K in keyof M & string]: { role: K; meta: M[K]; content: string; timestamp: number };
}[keyof M & string];

/** Thread-scoped context passed to agents and moderator. */
export type ThreadContext<M extends RoleMeta = RoleMeta> = {
  threadId: string;
  currentRole: {
    name: string;
    systemPrompt: string;
  };
  start: StartStep;
  steps: RoleStep<M>[];
};

/** Raw string output from an LLM/CLI adapter; meta is extracted by the engine. */
export type AgentFn = (ctx: ThreadContext) => Promise<string>;

/** Runtime agent assignment (optional per-role overrides). */
export type AgentBinding = {
  agent: AgentFn;
  overrides?: Partial<Record<string, AgentFn>>;
};

/** Structured extraction settings for the workflow engine. */
export type ExtractConfig = {
  provider: LlmProvider;
  dryRun: boolean;
};

/** Role wiring: prompts, schema, dry-run meta, and human-readable description. */
export type RoleDefinition<Meta extends Record<string, unknown>> = {
  description: string;
  systemPrompt: string;
  schema: z.ZodType<Meta>;
  dryRunMeta: Meta;
};

/**
 * The Moderator — a pure routing function.
 * Receives the full thread context (start + all prior steps).
 * On initial call, `steps` is empty.
 * Returns the next role name or END to terminate.
 */
export type Moderator<M extends RoleMeta> = (
  ctx: ThreadContext<M>,
) => (keyof M & string) | typeof END;

/** Complete workflow definition as authored by users. */
export type WorkflowDefinition<M extends RoleMeta> = {
  description: string;
  roles: { [K in keyof M & string]: RoleDefinition<M[K]> };
  moderator: Moderator<M>;
};
