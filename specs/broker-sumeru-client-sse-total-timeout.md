---
scenario: "consumeSse aborts the SSE stream and rejects when a total timeout elapses"
feature: broker
tags: [broker, sumeru, sse, timeout, defensive]
---

## Given

- `createSumeruClient(host, options?)` accepts an optional `options` argument with two
  numeric millisecond fields, both `T | null` (no `?:`):
  - `sseTotalTimeoutMs: number | null` — wall-clock cap for one `sendMessage` SSE
    consumption. Default when `null`/absent: `300_000` (5 minutes).
  - `sseHeartbeatTimeoutMs: number | null` — see the watchdog spec.
- A `SumeruClient` was created via `createSumeruClient(host, { sseTotalTimeoutMs: 1000, sseHeartbeatTimeoutMs: null })`.
- A session id `ses_abc` was previously created via `createSession`.
- The Sumeru server has accepted the `POST .../messages` request (HTTP 200) and is
  streaming an SSE response, but never emits a `done` event nor an `error` event
  before the timeout elapses (e.g., it dribbles only `turn` events slowly, or just
  hangs after the headers).

## When

- The caller invokes `await client.sendMessage({ gateway: "claude-code", sessionId: "ses_abc", content: "hello" })`.
- The total wall-clock time spent inside `consumeSse` (measured from the moment the
  function starts iterating the response body) reaches `sseTotalTimeoutMs` (1000ms in
  this scenario) without the stream having finished.

## Then

- `consumeSse` MUST construct an `AbortController` at the start of the function
  and arm a `setTimeout(() => controller.abort(), sseTotalTimeoutMs)` timer.
  The controller's `signal` is the abort source the underlying `reader.read()`
  loop responds to (either by passing the signal to a wrapping race, or by
  calling `reader.cancel(reason)` when the timer fires).
- When the timer fires, `consumeSse` MUST:
  - Call `reader.cancel(<abort reason>)` so the underlying socket is released
    (the existing `finally { reader.cancel() }` block already covers cleanup;
    the abort path simply triggers the same cleanup early).
  - Reject the `sendMessage` promise with an `Error` whose message is exactly:
    `sumeru SSE stream timed out after ${sseTotalTimeoutMs}ms (gateway=${gateway}, session=${sessionId})`.
- The error MUST surface to the caller of `sendMessage` (it must NOT be swallowed
  by the `finally` block's reader-cancel `try/catch`).
- The total-timeout timer MUST be cleared with `clearTimeout` on every exit path
  (success, normal error, abort) so completed sends do not leak a pending Node.js
  timer that keeps the event loop alive.
- The default value `300_000` MUST apply when `options` is omitted entirely or
  when `options.sseTotalTimeoutMs` is `null`.
- A test in `packages/broker/__tests__/sumeru-client-send-message.test.ts` named
  `"sendMessage rejects with timeout error when total timeout elapses"` MUST:
  1. Stub `globalThis.fetch` with an SSE response whose `ReadableStream` emits no
     bytes and never closes (e.g., a controller that is never enqueued/closed).
  2. Construct the client with `{ sseTotalTimeoutMs: 50, sseHeartbeatTimeoutMs: null }`.
  3. `await expect(client.sendMessage(...)).rejects.toThrow(/sumeru SSE stream timed out after 50ms/)`.
  4. Use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(50)` so the test runs
     in well under one real second.
- Existing happy-path tests (immediate `done` event) MUST continue to pass with
  the default 300_000ms timeout — the timer must not fire during normal operation
  and must not leak after `sendMessage` resolves.
