---
scenario: "createSumeruClient accepts an options bag with an SSE heartbeat-watchdog knob and applies a safe default"
feature: broker
tags: [broker, sumeru, factory, options, defaults]
---

## Given

- The existing `createSumeruClient(host: string): SumeruClient` factory is the
  only public construction path for the Sumeru HTTP client.
- An optional second argument `options` plumbs the per-event heartbeat
  watchdog required by issue #391.
- There is deliberately **no wall-clock "total" timeout**: how long an agent
  may run is decided solely by sumeru's `sendTimeoutMs` (single source of
  truth — see sumeru#105 / #439). The broker only guards against a *dead
  connection* via the heartbeat watchdog.

## When

- A caller invokes `createSumeruClient(host)` (single argument, current API).
- A caller invokes `createSumeruClient(host, {})` (empty options bag).
- A caller invokes `createSumeruClient(host, { sseHeartbeatTimeoutMs: 30_000 })`.
- A caller invokes `createSumeruClient(host, { sseHeartbeatTimeoutMs: null })`.

## Then

- The factory signature becomes
  `createSumeruClient(host: string, options?: SumeruClientOptions): SumeruClient`
  where `SumeruClientOptions` is exported from
  `packages/broker/src/sumeru-client/types.ts` (and re-exported from
  `packages/broker/src/index.ts`) as:
  ```typescript
  export type SumeruClientOptions = Readonly<{
    /** Per-event watchdog window. Defaults to 45_000ms (3x server heartbeat). */
    sseHeartbeatTimeoutMs: number | null;
  }>;
  ```
- The type uses `T | null` (NOT `?:`) per the project convention forbidding
  optional properties on type fields. The `options` parameter on the factory
  itself MAY be optional (it is a function argument, not a type field) and
  the factory MUST treat `undefined`, `{}`, and `{ sseHeartbeatTimeoutMs: null }`
  identically.
- Default (applied when the field is `null`, `undefined`, or the entire
  options object is missing):
  - `sseHeartbeatTimeoutMs` → `45_000` (3× the Sumeru server-side
    `sseHeartbeatMs` default of 15s — survives one missed heartbeat).
- The default MUST be exported as a named constant from
  `packages/broker/src/sumeru-client/types.ts`:
  ```typescript
  export const DEFAULT_SSE_HEARTBEAT_TIMEOUT_MS = 45_000;
  ```
  so tests and the broker layer can reference it without magic numbers.
- The existing public API (`createSumeruClient(host)`) MUST remain
  source-compatible — all current call sites in `packages/broker/src/send/send.ts`
  and the test suite continue to work without modification.
- A test
  `packages/broker/__tests__/sumeru-client-create.test.ts` named
  `"createSumeruClient applies default SSE timeouts when options are omitted"`
  MUST verify (via behaviour, not introspection) that the default 45_000ms
  heartbeat watchdog is in effect when no options are passed. One acceptable
  way: assert that with default options and a hung `fetch` stub plus
  `vi.useFakeTimers()`, advancing time by 44_999ms does NOT reject and
  advancing past 45_000ms DOES reject with the watchdog message.
