/**
 * Public types for `broker.send()` — the high-level orchestrator that
 * resolves the per-(threadId, role) session, talks to Sumeru via the
 * `sumeru-client` module, and persists the mapping in the session store.
 */

import type { RoleName, ThreadId } from "@united-workforce/protocol";

import type { SessionStore } from "../session-store/index.js";
import type { SumeruClient, SumeruClientOptions, SumeruDoneValue } from "../sumeru-client/index.js";

/**
 * Resolved routing for a `(threadId, role)` pair: which Sumeru host to talk
 * to and which gateway to address. In Phase 2 this is supplied directly by
 * the caller; Phase 3 will plumb it through `~/.uwf/config.yaml`.
 */
export type AgentRoute = Readonly<{
  host: string;
  gateway: string;
  /** Workspace root sent as `workspaceRoot` on session creation. */
  cwd: string | null;
}>;

/**
 * Hook for the caller to resolve the route for `(threadId, role)`. Phase 2
 * doesn't ship the config loader inside `broker` — the CLI integration in
 * Phase 3 wires it up.
 */
export type AgentRouteResolver = (role: RoleName) => Promise<AgentRoute> | AgentRoute;

/** Factory for the per-host `SumeruClient` cache. Default is `createSumeruClient`. */
export type SumeruClientFactory = (host: string, options?: SumeruClientOptions) => SumeruClient;

/**
 * A single assistant turn observed on the Sumeru SSE stream, projected for
 * broker callers (issue #397, Phase 1). This is the realtime-progress unit
 * delivered both incrementally via `SendArgs.onTurn` and as a full snapshot
 * via `SendResult.turns`.
 *
 * Per the project convention (`T | null`, no optional `?:`), `hash` is
 * `string | null` — non-null whenever the SSE event carries Sumeru's computed
 * hash.
 */
export type BrokerTurn = Readonly<{
  /** SSE `value.index`, or `-1` when the event omits it. */
  index: number;
  /** SSE `value.role` — always `"assistant"` for emitted turns. */
  role: "user" | "assistant" | "system";
  /** SSE `value.content`, verbatim (no trimming, no re-parse). */
  content: string;
  /** SSE `value.hash` (Sumeru-computed), verbatim; `null` when absent. */
  hash: string | null;
  /** SSE `value.timestamp`, or `""` when absent. */
  timestamp: string;
}>;

/**
 * Realtime per-turn callback. Invoked synchronously inside the SSE reader
 * loop, once per assistant turn, in arrival order — all invocations complete
 * before `send()` resolves. Assistant-turn-scoped: `user`/`system` turns do
 * not fire it.
 */
export type OnTurn = (turn: BrokerTurn) => void;

/** Inputs to `broker.send`. */
export type SendArgs = Readonly<{
  threadId: ThreadId;
  role: RoleName;
  prompt: string;
  /**
   * Realtime per-turn callback (issue #397). `null` ⇒ no callback and exact
   * pre-Phase-1 behavior (the only added work is accumulating `turns`).
   */
  onTurn: OnTurn | null;
}>;

/** Outcome of `broker.send` — a discriminated union on `kind` (issue #435).
 *
 * - `completed` — the Sumeru exchange ran to a `done` event. Carries the raw
 *   last-assistant-turn `output`, the `done` summary, and the full turn list.
 * - `suspended` — the exchange hit a send timeout and Sumeru emitted RFC #95
 *   `suspend`. Carries `reason`/`nativeId`/`elapsedMs` (for a future
 *   `--resume`) and the turns gathered before the timeout, but NO `done` /
 *   `output` / `assistantTurnCount`. Reading those without first narrowing
 *   `kind === "completed"` is a compile error — forcing every consumer to
 *   handle the suspended branch ("suspended ⇒ no done" holds at the type
 *   level).
 *
 * Both branches always carry `sessionId`, `reused`, and `turns` so routing /
 * resume bookkeeping is uniform.
 */
export type SendResult =
  | Readonly<{
      kind: "completed";
      /**
       * Raw last-assistant-turn content from the Sumeru SSE stream — verbatim.
       * Phase 2 explicitly does NOT do frontmatter extraction.
       */
      output: string;
      /** Sumeru session id that handled the request (post-fallback if any). */
      sessionId: string;
      /** Whether the cached session was reused (`true`) or a new one created (`false`). */
      reused: boolean;
      /** Number of assistant turns observed in the SSE response. */
      assistantTurnCount: number;
      /**
       * Full ordered list of assistant turns observed in the SSE response
       * (issue #397, Phase 1). Same population and ordering as the `onTurn`
       * callbacks. Invariants: `turns.length === assistantTurnCount` and, when
       * non-empty, `turns[turns.length - 1].content === output`.
       */
      turns: readonly BrokerTurn[];
      /** Per-exchange summary delivered by the final `done` event. */
      done: SumeruDoneValue;
    }>
  | Readonly<{
      kind: "suspended";
      /** Sumeru session id that handled the request (the future resume reuses it). */
      sessionId: string;
      /** Whether the cached session was reused (`true`) or a new one created (`false`). */
      reused: boolean;
      /** Always `"timeout"` in Phase 2 — the only suspend trigger Sumeru emits. */
      reason: "timeout";
      /** Sumeru-native session id to `--resume` from on continuation. */
      nativeId: string;
      /** Wall-clock ms the send ran before the timeout fired. */
      elapsedMs: number;
      /**
       * Assistant turns gathered before the timeout, in arrival order. May be
       * empty — turns are not dropped on suspend (Phase 3 deepens retention).
       */
      turns: readonly BrokerTurn[];
    }>;

/** Stateless broker exposing `send`. */
export type Broker = Readonly<{
  send: (args: SendArgs) => Promise<SendResult>;
}>;

/** Construction options for `createBroker`. */
export type CreateBrokerOptions = Readonly<{
  sessionStore: SessionStore;
  resolveRoute: AgentRouteResolver;
  /** Override the Sumeru client factory (defaults to `createSumeruClient`). */
  clientFactory: SumeruClientFactory | null;
}>;
