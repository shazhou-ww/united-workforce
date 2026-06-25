---
"@united-workforce/broker": minor
---

feat(broker)!: remove `sseTotalTimeoutMs` wall-clock timeout (RFC sumeru#105 Phase 0)

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
