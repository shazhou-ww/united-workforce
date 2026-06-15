---
scenario: "createSumeruClient accepts an options bag with SSE timeout/watchdog knobs and applies safe defaults"
feature: broker
tags: [broker, sumeru, factory, options, defaults]
---

## Given

- The existing `createSumeruClient(host: string): SumeruClient` factory is the
  only public construction path for the Sumeru HTTP client.
- A new optional second argument `options` is being introduced to plumb the
  defensive timeouts required by issue #391.

## When

- A caller invokes `createSumeruClient(host)` (single argument, current API).
- A caller invokes `createSumeruClient(host, {})` (empty options bag).
- A caller invokes `createSumeruClient(host, { sseTotalTimeoutMs: 60_000, sseHeartbeatTimeoutMs: 30_000 })`.
- A caller invokes `createSumeruClient(host, { sseTotalTimeoutMs: null, sseHeartbeatTimeoutMs: null })`.

## Then

- The factory signature becomes
  `createSumeruClient(host: string, options?: SumeruClientOptions): SumeruClient`
  where `SumeruClientOptions` is exported from
  `packages/broker/src/sumeru-client/types.ts` (and re-exported from
  `packages/broker/src/index.ts`) as:
  ```typescript
  export type SumeruClientOptions = Readonly<{
    /** Wall-clock cap on one sendMessage SSE consumption. Defaults to 300_000ms. */
    sseTotalTimeoutMs: number | null;
    /** Per-event watchdog window. Defaults to 45_000ms (3x server heartbeat). */
    sseHeartbeatTimeoutMs: number | null;
  }>;
  ```
- The type uses `T | null` (NOT `?:`) per the project convention forbidding
  optional properties on type fields. The `options` parameter on the factory
  itself MAY be optional (it is a function argument, not a type field) and
  the factory MUST treat `undefined` and `{}` and `{ sseTotalTimeoutMs: null, sseHeartbeatTimeoutMs: null }`
  identically.
- Defaults (applied when the field is `null`, `undefined`, or the entire
  options object is missing):
  - `sseTotalTimeoutMs` → `300_000` (5 minutes — long enough for slow ReAct
    loops, short enough that a stuck thread fails within reasonable wall time).
  - `sseHeartbeatTimeoutMs` → `45_000` (3× the Sumeru server-side
    `sseHeartbeatMs` default of 15s — survives one missed heartbeat).
- Both defaults MUST be exported as named constants from
  `packages/broker/src/sumeru-client/types.ts`:
  ```typescript
  export const DEFAULT_SSE_TOTAL_TIMEOUT_MS = 300_000;
  export const DEFAULT_SSE_HEARTBEAT_TIMEOUT_MS = 45_000;
  ```
  so tests and the broker layer can reference them without magic numbers.
- The existing public API (`createSumeruClient(host)`) MUST remain
  source-compatible — all current call sites in `packages/broker/src/send/send.ts`
  and the test suite continue to work without modification. The
  `SumeruClientFactory` type
  (`packages/broker/src/send/types.ts`) MAY be widened to
  `(host: string, options?: SumeruClientOptions) => SumeruClient`, but
  `send.ts` continues to call it with a single argument unless plumbing the
  options through is part of this issue (it is NOT — that is a follow-up).
- A test
  `packages/broker/__tests__/sumeru-client-create.test.ts` named
  `"createSumeruClient applies default SSE timeouts when options are omitted"`
  MUST verify (via behaviour, not introspection) that the default 300_000ms
  total timeout and 45_000ms heartbeat timeout are in effect when no options
  are passed. One acceptable way: assert that with default options and a
  hung `fetch` stub plus `vi.useFakeTimers()`, advancing time by 299_999ms
  does NOT reject and advancing by 300_001ms DOES reject.
