---
"@united-workforce/broker": minor
---

feat(broker): SSE reconnect on watchdog timeout via Last-Event-ID (#446)

When the per-event heartbeat watchdog fires during `sendMessage`, the broker
now attempts one reconnect POST with an empty body and a `Last-Event-ID` header
set to the last consumed SSE event id. Assistant turns received before the
watchdog are preserved and merged with turns from the resumed stream.

Refs #446, #391, sumeru#105
