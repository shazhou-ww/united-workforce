---
scenario: "consumeSse aborts when no SSE event arrives within the heartbeat watchdog window"
feature: broker
tags: [broker, sumeru, sse, heartbeat, watchdog, defensive]
---

## Given

- `createSumeruClient(host, options?)` accepts (per the total-timeout spec) an
  `sseHeartbeatTimeoutMs: number | null` option. Default when `null`/absent:
  `45_000` (3× the Sumeru server-side default `sseHeartbeatMs` of 15s, which
  gives one missed heartbeat plus headroom).
- A `SumeruClient` was created via `createSumeruClient(host, { sseHeartbeatTimeoutMs: 100 })`.
- A session id `ses_abc` was previously created via `createSession`.
- Sumeru emits `heartbeat` SSE events periodically (default every 15s on the
  server side) AND emits `turn` events for each agent turn.
- The Sumeru server has accepted the `POST .../messages` request (HTTP 200) and
  is streaming an SSE response, but stops emitting events for longer than
  `sseHeartbeatTimeoutMs`.

## When

- The caller invokes `await client.sendMessage({ gateway: "claude-code", sessionId: "ses_abc", content: "hello" })`.
- The wall-clock interval between two consecutive SSE events (measured from the
  end of the previous parsed event to the receipt of the next byte) reaches
  `sseHeartbeatTimeoutMs` (100ms in this scenario) without any new event having
  arrived.

## Then

- `consumeSse` MUST arm a per-stream watchdog timer in addition to the total
  timeout:
  - Initial arm: a `setTimeout(() => controller.abort(), sseHeartbeatTimeoutMs)`
    started immediately after `reader = body.getReader()` and before the first
    `reader.read()`.
  - Reset: every time `processEvents` consumes one or more SSE events (`turn`,
    `heartbeat`, `error`, `done`, or any other recognised event kind), the
    watchdog MUST be reset by clearing the previous timer and arming a new one.
    A small reusable helper `resetWatchdog()` is acceptable.
  - The reset MUST happen for `heartbeat` events too — that is the entire point
    of heartbeats: they prove the server is still alive.
- When the watchdog fires, `consumeSse` MUST:
  - Call `reader.cancel(<abort reason>)` to tear down the socket.
  - Reject the `sendMessage` promise with an `Error` whose message is exactly:
    `sumeru SSE stream watchdog: no event received within ${sseHeartbeatTimeoutMs}ms (gateway=${gateway}, session=${sessionId})`.
- The watchdog timer MUST be cleared on every exit path (success, error,
  total-timeout abort) — no dangling timers may keep the event loop alive after
  `sendMessage` resolves or rejects.
- The watchdog and the total timeout share the same `AbortController`; whichever
  fires first wins, and the one that did NOT fire is cleared in the `finally`
  block.
- The default value `45_000` MUST apply when `options` is omitted entirely or
  when `options.sseHeartbeatTimeoutMs` is `null`.
- A test in `packages/broker/__tests__/sumeru-client-send-message.test.ts` named
  `"sendMessage rejects with watchdog error when no events arrive within heartbeat window"` MUST:
  1. Stub `globalThis.fetch` with an SSE response whose `ReadableStream` emits
     ONE `turn` frame, then goes silent indefinitely (no `done`, no further
     events, never closes).
  2. Construct the client with `{ sseHeartbeatTimeoutMs: 50 }`.
  3. `await expect(client.sendMessage(...)).rejects.toThrow(/sumeru SSE stream watchdog: no event received within 50ms/)`.
  4. Use `vi.useFakeTimers()` and advance time by 50ms after the first frame is
     consumed.
- A second test `"heartbeat events reset the watchdog and allow long-running streams"` MUST:
  1. Stub fetch with a stream that emits `heartbeat` frames every 30ms for 200ms
     total, followed by an assistant `turn` and a `done`.
  2. Construct the client with `sseHeartbeatTimeoutMs: 50`.
  3. `await expect(client.sendMessage(...)).resolves.toMatchObject({ output: <expected> })` — the watchdog must NOT fire because each heartbeat resets it.
- Existing happy-path tests (immediate `turn` + `done`) MUST continue to pass —
  the watchdog must not fire during normal operation and must not leak after
  `sendMessage` resolves.
