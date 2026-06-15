---
scenario: "createSumeruClient(host) returns a stateless client bound to a Sumeru host URL"
feature: broker
tags: [broker, sumeru, http, client]
---

## Given
- `@united-workforce/broker` exposes `createSumeruClient` from its package barrel `src/index.ts`
- The function lives under `packages/broker/src/sumeru-client/` (folder module — `index.ts` re-exports, `types.ts` holds types)
- `host` is a string URL (with or without trailing slash, e.g. `http://127.0.0.1:7900` or `http://127.0.0.1:7900/`)
- The runtime is Node 18+ (global `fetch` available — no extra HTTP dependency)

## When
- A caller invokes `createSumeruClient(host)`

## Then
- It returns a frozen `SumeruClient` object exposing exactly two async methods:
  - `createSession(gateway: string): Promise<string>`
  - `sendMessage(args: { gateway: string; sessionId: string; content: string; cwd: string | null }): Promise<SumeruSendOutcome>`
- Trailing slashes on `host` are normalised: the client trims `/+$` so subsequent path joins never produce `//gateways/...`
- The client maintains no connection pool or shared state; each call uses `fetch` directly and is safe to invoke from a single short-lived `uwf thread exec` process
- The `host` string is captured in the returned closure — repeated calls reuse the same base URL
- The factory does not perform any I/O at construction time (no preflight ping)
- The factory does not throw for syntactically valid host URLs; it is the responsibility of `createSession` / `sendMessage` to surface network errors
