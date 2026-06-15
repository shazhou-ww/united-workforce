# @united-workforce/broker

Session-mapping persistence + Sumeru HTTP client for the uwf broker.

## Scope

| Phase | Issue | Status |
|-------|-------|--------|
| Parent broker design | #364 | — |
| Phase 1 — session-mapping persistence | #378 | ✅ shipped |
| Phase 2 — Sumeru HTTP client + `broker.send()` | #379 | ✅ this release |
| Phase 3 — CLI integration | #380 | upcoming |
| Phase 4 — lifecycle / GC | #381 | upcoming |

This package is the in-process broker library. CLI plumbing is intentionally
out of scope for Phases 1–2; that lands in Phase 3.

## Public API

```typescript
import {
  // Phase 1 — session store
  createSessionStore,
  // Phase 2 — Sumeru HTTP client
  createSumeruClient,
  SumeruSessionNotFoundError,
  SUMERU_SESSION_NOT_FOUND,
  // SSE consumption defensive timer defaults (#391)
  DEFAULT_SSE_TOTAL_TIMEOUT_MS,
  DEFAULT_SSE_HEARTBEAT_TIMEOUT_MS,
  // Phase 2 — orchestrator
  createBroker,
} from "@united-workforce/broker";
import type {
  SessionInput,
  SessionRecord,
  SessionStore,
  SumeruClient,
  SumeruClientOptions,
  SumeruSendOutcome,
  CreateSessionArgs,
  SendMessageArgs,
  AgentRoute,
  AgentRouteResolver,
  Broker,
  CreateBrokerOptions,
  SendArgs,
  SendResult,
  SumeruClientFactory,
} from "@united-workforce/broker";
```

### Session store (Phase 1)

```typescript
const store = createSessionStore({ dbPath: "/tmp/sessions.db" });

// upsertSession: insert OR replace (preserves createdAt on update)
store.upsertSession({
  threadId: "06FCHRTFS6STQY3ET1355NXYS0",
  role: "planner",
  host: "http://127.0.0.1:7900",
  gateway: "claude-code",
  sessionId: "ses_abc",
});

// getSession: returns SessionRecord | null
const row = store.getSession("06FCHRTFS6STQY3ET1355NXYS0", "planner");

// listByThread: returns rows sorted by role ASC
const rows = store.listByThread("06FCHRTFS6STQY3ET1355NXYS0");

// deleteByThread: returns rows-deleted count
const count = store.deleteByThread("06FCHRTFS6STQY3ET1355NXYS0");

store.close();
```

When `dbPath` is omitted, the store opens
`<getDefaultStorageRoot()>/broker/sessions.db` (e.g. `~/.uwf/broker/sessions.db`).

### Sumeru HTTP client (Phase 2)

```typescript
const client = createSumeruClient("http://127.0.0.1:7900");

// POST /gateways/:gw/sessions, returns the new session id.
// Body is `{}` when cwd is null, `{"workspaceRoot": cwd}` otherwise.
const sessionId = await client.createSession({
  gateway: "claude-code",
  cwd: process.cwd(),
});

// POST /gateways/:gw/sessions/:id/messages, consumes the SSE stream.
// Returns the LAST assistant turn's raw content + the `done` summary.
// Throws `SumeruSessionNotFoundError` on 404 session_not_found so callers
// can recognise it and trigger the fallback path.
const outcome = await client.sendMessage({
  gateway: "claude-code",
  sessionId,
  content: "hello",
});
console.log(outcome.output);                  // last assistant turn (raw)
console.log(outcome.assistantTurnCount);      // count of assistant turns
console.log(outcome.done);                    // { turnCount, tokens, durationMs }
```

The client is stateless — `host` is captured in the closure and trailing
slashes are normalised so subsequent path joins never produce `//gateways/`.
No I/O happens at construction time.

#### SSE timeouts (#391)

`createSumeruClient` accepts an optional second argument that bounds the
SSE consumption window so a stuck Sumeru stream never hangs the broker:

```typescript
const client = createSumeruClient("http://127.0.0.1:7900", {
  // Wall-clock cap on one sendMessage SSE consumption.
  // null (or absent) → DEFAULT_SSE_TOTAL_TIMEOUT_MS (300_000ms = 5min).
  sseTotalTimeoutMs: 60_000,
  // Per-event watchdog — reset on every consumed event (turn / heartbeat / …).
  // null (or absent) → DEFAULT_SSE_HEARTBEAT_TIMEOUT_MS (45_000ms ≈ 3× server heartbeat).
  sseHeartbeatTimeoutMs: 30_000,
});
```

When either timer fires the reader is cancelled and `sendMessage` rejects
with one of:

- `sumeru SSE stream timed out after Nms (gateway=…, session=…)`
- `sumeru SSE stream watchdog: no event received within Nms (gateway=…, session=…)`

Both timers are cleared on every exit path (success, error, or abort) so
completed sends never leak a pending Node.js timer.

### Broker orchestration (Phase 2)

```typescript
const broker = createBroker({
  sessionStore: store,
  resolveRoute: (role) => ({
    host: "http://127.0.0.1:7900",
    gateway: "claude-code",
    cwd: process.cwd(),
  }),
  clientFactory: null, // defaults to createSumeruClient
});

const result = await broker.send({
  threadId: "06FCHRTFS6STQY3ET1355NXYS0",
  role: "planner",
  prompt: "next step",
});
console.log(result.output);    // raw last-assistant-turn content
console.log(result.sessionId); // session that handled the request
console.log(result.reused);    // true on cache hit, false on cold start / fallback
```

`broker.send()` resolves the cached session for `(threadId, role)`. On a
cache hit it sends to the cached session id; on a cache miss it creates a
new session, **upserts the mapping BEFORE the first message** (write-before-
stream invariant), then sends.

If the cached session id is rejected with HTTP 404 / `session_not_found`,
broker silently:

1. Logs a warn via `createLogger` (tag `M4Q7QHSF`).
2. Creates a fresh session via the route's host/gateway.
3. Upserts the new session id.
4. Retries the same prompt verbatim on the new session.

A second 404 propagates as a normal error — the retry runs at most once.
Non-404 errors propagate without any retry.

> Phase 2 explicitly does **not** do frontmatter extraction. `result.output`
> is the assistant content byte-for-byte; Phase 3 adds schema-aware
> extraction on top.

## Storage

- Single SQLite database (Node's built-in `node:sqlite`, no native deps).
- Schema migration is idempotent — running `createSessionStore` twice against
  the same path is a no-op after the first run.
- WAL journal mode so concurrent reads from `uwf thread list` don't block
  writers.
