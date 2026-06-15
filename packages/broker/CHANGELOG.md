# @united-workforce/broker

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
