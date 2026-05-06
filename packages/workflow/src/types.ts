/** Sentinel values for automaton control flow. */
export const START = "__start__" as const;
export const END = "__end__" as const;

/** Maps role names → their meta types. Single generic drives all inference. */
export type RoleMeta = Record<string, Record<string, unknown>>;

/** Typed output of a Role execution. */
export type RoleResult<Meta extends Record<string, unknown>> = {
  content: string;
  meta: Meta;
};

/** Engine start frame: initial prompt + thread identity. */
export type StartStep = {
  role: typeof START;
  content: string;
  meta: { maxRounds: number; threadId: string };
  timestamp: number;
};

/** A completed role step in the thread. */
export type RoleStep<M extends RoleMeta> = {
  [K in keyof M & string]: { role: K; meta: M[K]; content: string; timestamp: number };
}[keyof M & string];

/** Thread-scoped context passed to roles and moderator. */
export type ThreadContext<M extends RoleMeta = RoleMeta> = {
  threadId: string;
  start: StartStep;
  steps: RoleStep<M>[];
};

/**
 * A Role — receives full thread context, returns typed content + meta.
 * Implementation can be an agent, LLM call, script, HTTP request, etc.
 */
export type Role<Meta extends Record<string, unknown>> = (
  ctx: ThreadContext,
) => Promise<RoleResult<Meta>>;

/**
 * An Agent — raw string output interface for LLM/CLI adapters.
 * Structured meta is extracted by the role's extract layer.
 */
export type AgentFn = (ctx: ThreadContext, systemPrompt: string) => Promise<string>;

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
  name: string;
  roles: { [K in keyof M & string]: Role<M[K]> };
  moderator: Moderator<M>;
};
