/**
 * `broker.send()` — orchestrate one Sumeru exchange for `(threadId, role)`.
 *
 * Flow:
 *  1. Look up the cached `SessionRecord` in the session store.
 *  2. If found, send to the cached session id.
 *      - On `404 session_not_found`, log a warn, create a fresh session,
 *        upsert the new id BEFORE retrying (write-before-stream invariant),
 *        then retry once with the original prompt.
 *  3. If not found, resolve the agent route, create a new session, upsert
 *     the mapping BEFORE the first message, then send.
 *
 * Phase 2 returns the raw last-assistant-turn content. Frontmatter
 * extraction is Phase 3 scope.
 */

import { createLogger } from "@united-workforce/util";

import type { SessionStore } from "../session-store/index.js";
import {
  createSumeruClient,
  type SumeruClient,
  type SumeruSendOutcome,
  SumeruSessionNotFoundError,
  type SumeruTurnListener,
  type SumeruTurnValue,
} from "../sumeru-client/index.js";
import type {
  AgentRoute,
  AgentRouteResolver,
  Broker,
  BrokerTurn,
  CreateBrokerOptions,
  OnTurn,
  SendArgs,
  SendResult,
  SumeruClientFactory,
} from "./types.js";

const log = createLogger({ sink: { kind: "stderr" } });

/**
 * Project a raw Sumeru turn value onto the broker's public `BrokerTurn`
 * shape (issue #397) — narrowed to the fields callers depend on.
 */
function toBrokerTurn(turn: SumeruTurnValue): BrokerTurn {
  return {
    index: turn.index,
    role: turn.role,
    content: turn.content,
    hash: turn.hash,
    timestamp: turn.timestamp,
  };
}

/**
 * Adapt a caller's `onTurn` (over `BrokerTurn`) into a `SumeruTurnListener`
 * (over `SumeruTurnValue`). Returns `undefined` when `onTurn` is `null` so the
 * client takes its pre-Phase-1 path with zero per-turn work.
 */
function toTurnListener(onTurn: OnTurn | null): SumeruTurnListener | undefined {
  if (onTurn === null) return undefined;
  return (turn: SumeruTurnValue) => onTurn(toBrokerTurn(turn));
}

/**
 * Create a stateless broker. The session store and route resolver are
 * captured in the closure; each `send()` call performs its own lookups,
 * upserts, and SSE consumption.
 */
export function createBroker(options: CreateBrokerOptions): Broker {
  const { sessionStore, resolveRoute } = options;
  const clientFactory: SumeruClientFactory =
    options.clientFactory !== null ? options.clientFactory : createSumeruClient;

  // Per-host client cache — `createSumeruClient` is cheap, but reusing the
  // same closure across retries within a single `send()` keeps the call
  // graph clean and predictable.
  const clients = new Map<string, SumeruClient>();

  function getClient(host: string): SumeruClient {
    const existing = clients.get(host);
    if (existing !== undefined) return existing;
    const fresh = clientFactory(host);
    clients.set(host, fresh);
    return fresh;
  }

  async function send(args: SendArgs): Promise<SendResult> {
    const cached = sessionStore.getSession(args.threadId, args.role);

    if (cached !== null) {
      const client = getClient(cached.host);
      return sendOnExistingSession({
        args,
        client,
        cachedHost: cached.host,
        cachedGateway: cached.gateway,
        cachedSessionId: cached.sessionId,
        sessionStore,
        resolveRoute,
        getClient,
      });
    }

    return sendOnNewSession({
      args,
      sessionStore,
      resolveRoute,
      getClient,
    });
  }

  return Object.freeze({ send });
}

type ExistingSessionArgs = Readonly<{
  args: SendArgs;
  client: SumeruClient;
  cachedHost: string;
  cachedGateway: string;
  cachedSessionId: string;
  sessionStore: SessionStore;
  resolveRoute: AgentRouteResolver;
  getClient: (host: string) => SumeruClient;
}>;

async function sendOnExistingSession(args: ExistingSessionArgs): Promise<SendResult> {
  try {
    const outcome = await args.client.sendMessage(
      {
        gateway: args.cachedGateway,
        sessionId: args.cachedSessionId,
        content: args.args.prompt,
      },
      toTurnListener(args.args.onTurn),
    );
    return buildResult(outcome, args.cachedSessionId, true);
  } catch (err) {
    if (err instanceof SumeruSessionNotFoundError) {
      log(
        "M4Q7QHSF",
        `cached sumeru session ${args.cachedSessionId} rejected (session_not_found) — gateway=${args.cachedGateway} thread=${args.args.threadId} role=${args.args.role}; creating fresh session`,
      );
      return runFallback(args);
    }
    throw err;
  }
}

async function runFallback(args: ExistingSessionArgs): Promise<SendResult> {
  // The cached row's host/gateway is authoritative for the fallback —
  // a stale session id implies the same Sumeru instance restarted, not
  // that the agent config has changed.
  const route: AgentRoute = {
    host: args.cachedHost,
    gateway: args.cachedGateway,
    cwd: await resolveCwd(args.resolveRoute, args.args.role),
  };
  const client = args.getClient(route.host);
  const newSessionId = await client.createSession({
    gateway: route.gateway,
    cwd: route.cwd,
  });
  args.sessionStore.upsertSession({
    threadId: args.args.threadId,
    role: args.args.role,
    host: route.host,
    gateway: route.gateway,
    sessionId: newSessionId,
  });
  const outcome = await client.sendMessage(
    {
      gateway: route.gateway,
      sessionId: newSessionId,
      content: args.args.prompt,
    },
    toTurnListener(args.args.onTurn),
  );
  return buildResult(outcome, newSessionId, false);
}

type NewSessionArgs = Readonly<{
  args: SendArgs;
  sessionStore: SessionStore;
  resolveRoute: AgentRouteResolver;
  getClient: (host: string) => SumeruClient;
}>;

async function sendOnNewSession(input: NewSessionArgs): Promise<SendResult> {
  const route = await Promise.resolve(input.resolveRoute(input.args.role));
  const client = input.getClient(route.host);
  const newSessionId = await client.createSession({
    gateway: route.gateway,
    cwd: route.cwd,
  });
  input.sessionStore.upsertSession({
    threadId: input.args.threadId,
    role: input.args.role,
    host: route.host,
    gateway: route.gateway,
    sessionId: newSessionId,
  });
  const outcome = await client.sendMessage(
    {
      gateway: route.gateway,
      sessionId: newSessionId,
      content: input.args.prompt,
    },
    toTurnListener(input.args.onTurn),
  );
  return buildResult(outcome, newSessionId, false);
}

async function resolveCwd(resolveRoute: AgentRouteResolver, role: string): Promise<string | null> {
  const route = await Promise.resolve(resolveRoute(role));
  return route.cwd;
}

function buildResult(outcome: SumeruSendOutcome, sessionId: string, reused: boolean): SendResult {
  return {
    output: outcome.output,
    sessionId,
    reused,
    assistantTurnCount: outcome.assistantTurnCount,
    turns: outcome.assistantTurns.map(toBrokerTurn),
    done: outcome.done,
  };
}
