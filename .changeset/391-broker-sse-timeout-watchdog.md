---
"@united-workforce/broker": minor
---

fix(broker): add SSE total-timeout + heartbeat watchdog to `consumeSse` (#391)

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
