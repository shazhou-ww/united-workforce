# @united-workforce/broker

## 0.3.0 — 2026-06-26

- fix(broker): add SSE total-timeout + heartbeat watchdog to `consumeSse` (#391)
  
  `consumeSse()` previously hung forever on `reader.read()` when the
  Sumeru SSE stream stopped sending bytes — a stuck thread silently kept
  the broker process alive with no visible error. Two defensive timers
  now bound the consumption window:
  
  - **Total timeout** — wall-clock cap on one `sendMessage` SSE
    consumption. Defaults to `300_000ms` (5 minutes). Cleared on every
    exit path.
  - **Heartbeat watchdog** — per-event timer reset on every consumed SSE
    event (including server-sent `heartbeat` events). Fires when the
    inter-event gap exceeds the configured window. Defaults to `45_000ms`
    (3× the Sumeru server-side `sseHeartbeatMs` default of 15s).
  
  Both knobs are exposed through a new optional `options` argument on
  `createSumeruClient(host, options?)`:
  
  ```ts
  createSumeruClient(host, {
    sseTotalTimeoutMs: 60_000,
    sseHeartbeatTimeoutMs: 30_000,
  });
  ```
  
  Both fields accept `T | null` (`null` or absent → default). Named
  constants `DEFAULT_SSE_TOTAL_TIMEOUT_MS` and
  `DEFAULT_SSE_HEARTBEAT_TIMEOUT_MS` are also exported. The single-arg
  form `createSumeruClient(host)` remains source-compatible with all
  existing call sites — `SumeruClientFactory` is widened to
  `(host, options?) => SumeruClient`.
  
  When either timer fires the reader is cancelled and `sendMessage`
  rejects with one of:
  
  - `sumeru SSE stream timed out after Nms (gateway=…, session=…)`
  - `sumeru SSE stream watchdog: no event received within Nms (gateway=…, session=…)`
- feat(broker): expose per-turn realtime callback + `SendResult.turns` (#397)
  
  Phase 1 of the realtime-turns RFC. `@united-workforce/broker` now surfaces
  each assistant turn as it arrives on the Sumeru SSE stream, instead of only
  returning the final `output` once `send()` resolves. Single-package, fully
  backward-compatible, additive change.
  
  New public type `BrokerTurn`:
  
  ```ts
  type BrokerTurn = Readonly<{
    index: number;            // SSE value.index, or -1 when absent
    role: "user" | "assistant" | "system";
    content: string;          // SSE value.content, verbatim
    hash: string | null;      // Sumeru-computed value.hash, verbatim
    timestamp: string;        // SSE value.timestamp, or "" when absent
  }>;
  ```
  
  Two additions, both **assistant-turn-scoped** and in arrival order:
  
  - **`SendArgs.onTurn: ((turn: BrokerTurn) => void) | null`** — fires
    synchronously inside the `consumeSse` reader loop, once per assistant turn,
    as each `turn` event is parsed and applied (not batched after `done`). All
    invocations complete before `send()` resolves. `null` ⇒ exact pre-Phase-1
    behavior (the only added work is accumulating `turns`).
  - **`SendResult.turns: readonly BrokerTurn[]`** — the full ordered snapshot of
    the same assistant turns. Invariants: `turns.length === assistantTurnCount`
    and, when non-empty, `turns[turns.length - 1].content === output`.
  
  `output`, `sessionId`, `reused`, `assistantTurnCount`, and `done` retain their
  prior meaning and values — `turns` is purely additive. Non-assistant
  (`user`/`system`) turns never fire `onTurn` and are excluded from `turns`.
  
  `BrokerTurn` is exported from the package barrel
  (`import { type BrokerTurn } from "@united-workforce/broker"`). Internally the
  `sumeru-client` `sendMessage(args, onAssistantTurn?)` gained an optional
  listener argument and `SumeruSendOutcome` gained `assistantTurns`, keeping all
  existing single-arg call sites source-compatible.
  
  CLI consumption of `onTurn` is Phase 2 — out of scope here.
- feat(broker): recognize sumeru `event: suspend` and wire timeout → suspend → resume (#435)
  
  RFC #95 Phase 2. A sumeru send that hits its timeout now emits a terminal
  SSE `suspend` frame instead of `done`. The broker recognizes it, the CLI
  parks the thread on the existing `$SUSPEND` exit, and `uwf thread resume`
  continues the run by `nativeId` — no new thread status and no new command.
  
  **`@united-workforce/broker`**
  
  - `sumeru-client`: `consumeSse` now handles `event: suspend`. A new
    `parseSuspendEvent` validates the `@sumeru/suspend` envelope
    (`{ reason: "timeout", nativeId, elapsedMs }`), mirroring `parseErrorEvent`;
    malformed JSON or a missing envelope surface a descriptive stream error.
    Suspend is terminal — a trailing `done` is ignored.
  - New exported type `SumeruSuspendValue = Readonly<{ reason: "timeout";
    nativeId: string; elapsedMs: number }>`.
  - `SumeruSendOutcome` is now a discriminated union on `kind`
    (`"completed" | "suspended"`); `output`/`done`/`assistantTurnCount` live
    only on the completed branch.
  - **Breaking (pre-1.0):** `SendResult` is likewise a discriminated union —
    `kind:"completed"` carries `output` + required `done`; `kind:"suspended"`
    carries `reason`/`nativeId`/`elapsedMs` and no `done`. Consumers must
    narrow `result.kind === "completed"` before reading `output`/`done`, so
    "suspended ⇒ no done" holds at the type level.
  
  **`@united-workforce/cli`**
  
  - `executeBrokerStep`: when `broker.send()` returns `kind:"suspended"`
    (including inside the frontmatter-retry loop), route into the existing
    `$SUSPEND` machinery via a module-private `buildSuspendOutput` +
    the public `trySuspendFastPath` rather than the error path. The thread
    enters `suspended` (a human gate), is never retried, and records
    `nativeId`/`elapsedMs`/`reason` on the detail node for diagnostics. The
    completed path is unchanged.
  
  The `$SUSPEND` wire format is a one-liner over `SUSPEND_STATUS`, kept private
  in `broker-step.ts`: the #381 public-API cleanup deliberately keeps the
  adapter-side `buildSuspendOutput` out of the `@united-workforce/util-agent`
  barrel, and the broker step is engine/CLI code, not an adapter.
  
  The resume loop is verified, not modified: `uwf thread resume` already
  accepts `suspended` and issues a fresh `broker.send()` on the same mapped
  `(threadId, role)` session, so the sumeru adapter resumes from its own
  history by `nativeId`.
- feat(broker)!: remove `sseTotalTimeoutMs` wall-clock timeout (RFC sumeru#105 Phase 0)
  
  The broker no longer imposes a wall-clock cap on a single `sendMessage` SSE
  consumption. Previously `sseTotalTimeoutMs` (default 5min) would abort the
  stream regardless of agent progress — which **contradicted** sumeru's
  `sendTimeoutMs` (default 2h) and silently killed any task running longer than
  5 minutes before #95's timeout-as-suspend could ever trigger.
  
  **How long an agent may run is now decided solely by sumeru's `sendTimeoutMs`
  (single source of truth).** The broker keeps only the per-event heartbeat
  watchdog (`sseHeartbeatTimeoutMs`), which guards against a *dead connection* —
  sumeru emits heartbeats on a fixed wall-clock interval independent of agent
  turns, so a healthy-but-slow agent never trips it.
  
  BREAKING CHANGE: `SumeruClientOptions.sseTotalTimeoutMs` and the
  `DEFAULT_SSE_TOTAL_TIMEOUT_MS` export are removed. Callers passing
  `sseTotalTimeoutMs` must drop it; the heartbeat watchdog (`sseHeartbeatTimeoutMs`)
  is unchanged.
  
  Refs sumeru#105, #439, #95, #92
- feat(broker): SSE reconnect on watchdog timeout via Last-Event-ID (#446)
  
  When the per-event heartbeat watchdog fires during `sendMessage`, the broker
  now attempts one reconnect POST with an empty body and a `Last-Event-ID` header
  set to the last consumed SSE event id. Assistant turns received before the
  watchdog are preserved and merged with turns from the resumed stream.
  
  Refs #446, #391, sumeru#105

## 0.2.0

### Minor Changes

- 2da4a1a: feat(broker): add Sumeru HTTP client + broker.send orchestration (Phase 2 / #379)

  Phase 2 of the broker rollout. Adds the `sumeru-client/` folder module with
  `createSumeruClient(host)` and a `SumeruSessionNotFoundError` typed error,
  plus the `send/` folder module with `createBroker(...)` and the
  `broker.send({ threadId, role, prompt })` API.

  Highlights:

  - **`createSumeruClient(host)`** — stateless HTTP client; trims trailing
    slashes; no I/O at construction; exposes `createSession({ gateway, cwd })`
    and `sendMessage({ gateway, sessionId, content })`.
  - **SSE consumption** — incremental parser, ignores heartbeats, surfaces
    error frames, rejects with the canonical `sumeru_session_not_found` typed
    error on 404, returns the LAST assistant turn's raw `content` plus the
    `done` summary.
  - **`broker.send()`** — looks up the cached `(threadId, role)` mapping;
    reuses the cached session on hit, creates a new one on miss, upserts
    BEFORE the first message (write-before-stream invariant), and silently
    retries once on 404 `session_not_found` after creating a fresh session
    (logged via `createLogger` warn). Returns the raw last-assistant-turn
    content — Phase 3 will add frontmatter extraction.
  - **Tests** — 40 new integration tests covering host normalisation,
    envelope parsing, SSE happy/error/edge paths, cache hit, cold start,
    404 fallback, non-404 propagation, and raw output preservation. Real
    `SessionStore` against temp SQLite; `fetch` stubbed via `vi.stubGlobal`
    with `ReadableStream` SSE bodies.

### Patch Changes

- Updated dependencies [aeb2449]
  - @united-workforce/protocol@0.4.0
  - @united-workforce/util@0.2.1
