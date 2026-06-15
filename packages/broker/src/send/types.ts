/**
 * Public types for `broker.send()` — the high-level orchestrator that
 * resolves the per-(threadId, role) session, talks to Sumeru via the
 * `sumeru-client` module, and persists the mapping in the session store.
 */

import type { RoleName, ThreadId } from "@united-workforce/protocol";

import type { SessionStore } from "../session-store/index.js";
import type { SumeruClient, SumeruDoneValue } from "../sumeru-client/index.js";

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
export type SumeruClientFactory = (host: string) => SumeruClient;

/** Inputs to `broker.send`. */
export type SendArgs = Readonly<{
  threadId: ThreadId;
  role: RoleName;
  prompt: string;
}>;

/** Outcome of `broker.send`. */
export type SendResult = Readonly<{
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
  /** Per-exchange summary delivered by the final `done` event. */
  done: SumeruDoneValue;
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
