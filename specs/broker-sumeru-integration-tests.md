---
scenario: "Phase 2 ships unit + integration tests covering session creation, SSE consumption, 404 fallback, and broker.send() orchestration"
feature: broker
tags: [broker, tests, vitest, integration]
---

## Given
- The broker package uses vitest (already configured in Phase 1: `pnpm test` → `vitest run __tests__/`)
- `__tests__/` is the package's test directory; tests are exempt from the `no dynamic import` rule
- Tests must run without a real Sumeru server in CI — HTTP and SSE are mocked

## When
- A developer runs `pnpm --filter @united-workforce/broker test`

## Then
- Test suites cover at minimum:
  1. **createSumeruClient** — host normalisation (with/without trailing slash), no I/O at construction
  2. **client.createSession** — POST URL, headers, body shape (with and without `cwd`), happy-path id extraction, error mapping for non-2xx and unexpected body
  3. **client.sendMessage** — POST URL, headers, body, SSE stream consumption with multiple `turn` frames + final `done`, last assistant turn wins, heartbeats ignored, error frames surface, missing-done rejection, missing-assistant-turn rejection
  4. **404 session_not_found** — `sendMessage` rejects with `SumeruSessionNotFoundError` carrying code `sumeru_session_not_found`
  5. **broker.send() — cache hit** — uses cached session, no `createSession` call, no upsert, returns `reused: true`
  6. **broker.send() — cache miss** — calls `createSession`, upserts BEFORE sending, returns `reused: false`
  7. **broker.send() — 404 fallback** — first send 404s, second `createSession` runs, store is upserted with new id, second send succeeds, log warn captured, returns `reused: false`
  8. **broker.send() — non-404 errors propagate** — 500 or network error from first send is NOT retried
- HTTP is mocked by stubbing global `fetch` (e.g. `vi.stubGlobal("fetch", ...)`) — no real sockets in tests
- SSE bodies are constructed as `ReadableStream<Uint8Array>` from arrays of pre-encoded frame strings to exercise the parser end-to-end
- The session store used in `broker.send` tests is opened against a temp SQLite path (e.g. via `mkdtempSync` + `createSessionStore({ dbPath })`) and closed in `afterEach`
- All tests pass; `pnpm run check` and `pnpm run typecheck` also pass
