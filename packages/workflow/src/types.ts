import type * as z from "zod/v4";

import type { CasStore } from "./cas.js";

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
  /** CAS hash of the serialized Merkle content node for this step's body text. */
  contentHash: string;
  meta: Record<string, unknown>;
  /** CAS hashes produced or consumed by this step (for GC traceability). */
  refs: string[];
};

/** Generator completion value from a workflow bundle (`run` export). Root hash is added by the engine. */
export type WorkflowCompletion = {
  returnCode: number;
  summary: string;
};

/** Final thread outcome from {@link executeThread}, including Merkle thread root CAS hash. */
export type WorkflowResult = WorkflowCompletion & {
  rootHash: string;
};

/** Input to a workflow — prompt plus optional historical steps for fork/resume. */
export type ThreadInput = {
  prompt: string;
  steps: RoleOutput[];
};

/** Options passed to a workflow bundle's `run` export (engine-provided). */
export type WorkflowFnOptions = {
  threadId: string;
  maxRounds: number;
  /** Nesting depth for workflow-as-agent chains; root threads use `0`. */
  depth: number;
  /** Global CAS store for Merkle content blobs (role step bodies). */
  cas: CasStore;
};

/** Bundle contract — named export `run` is a function returning an AsyncGenerator. */
export type WorkflowFn = (
  input: ThreadInput,
  options: WorkflowFnOptions,
) => AsyncGenerator<RoleOutput, WorkflowCompletion>;

/** Engine start frame: initial prompt + thread identity. */
export type StartStep = {
  role: typeof START;
  content: string;
  meta: { maxRounds: number };
  timestamp: number;
};

/** A completed role step in the thread. */
export type RoleStep<M extends RoleMeta> = {
  [K in keyof M & string]: {
    role: K;
    meta: M[K];
    contentHash: string;
    refs: string[];
    timestamp: number;
  };
}[keyof M & string];

/** Phase 1: Moderator decides next role. */
export type ModeratorContext<M extends RoleMeta = RoleMeta> = {
  threadId: string;
  /** Same as `WorkflowFnOptions.depth` for the active thread. */
  depth: number;
  start: StartStep;
  steps: RoleStep<M>[];
};

/** Phase 2: Agent executes — knows its role and prompt. */
export type AgentContext<M extends RoleMeta = RoleMeta> = ModeratorContext<M> & {
  currentRole: {
    name: string;
    systemPrompt: string;
  };
  cas: CasStore;
};

/** Phase 3: Extractor runs — has agent output; the extraction instruction is a separate argument to the extract function. */
export type ExtractContext<M extends RoleMeta = RoleMeta> = AgentContext<M> & {
  agentContent: string;
};

/** Alias — most external consumers see the agent-phase context. */
export type ThreadContext<M extends RoleMeta = RoleMeta> = AgentContext<M>;

/** Raw string output from an LLM/CLI adapter; meta is extracted by the engine. */
export type AgentFn = (ctx: AgentContext) => Promise<string>;

/** Runtime agent assignment (optional per-role overrides). */
export type AgentBinding = {
  agent: AgentFn;
  overrides?: Partial<Record<string, AgentFn>>;
};

/** Role wiring: prompts, schema, and human-readable description. */
export type RoleDefinition<Meta extends Record<string, unknown>> = {
  description: string;
  systemPrompt: string;
  extractPrompt: string;
  schema: z.ZodType<Meta>;
  /** When non-null, produces CAS hashes to persist on this role's steps (see `RoleOutput.refs`). */
  extractRefs: ((meta: Meta) => string[]) | null;
};

/**
 * The Moderator — a pure routing function.
 * Receives the full thread context (start + all prior steps).
 * On initial call, `steps` is empty.
 * Returns the next role name or END to terminate.
 */
export type Moderator<M extends RoleMeta> = (
  ctx: ModeratorContext<M>,
) => (keyof M & string) | typeof END;

/** Complete workflow definition as authored by users. */
export type WorkflowDefinition<M extends RoleMeta> = {
  description: string;
  roles: { [K in keyof M & string]: RoleDefinition<M[K]> };
  moderator: Moderator<M>;
};
