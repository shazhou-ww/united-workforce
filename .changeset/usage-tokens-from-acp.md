---
"@united-workforce/agent-hermes": patch
---

fix: read token usage from ACP PromptResponse instead of DB

Token counts (inputTokens, outputTokens) now come from the ACP
`PromptResponse.usage` field, which is populated synchronously from
`run_conversation()` return data — no WAL race condition.

Turns (assistant message count) still come from the DB via
`snapshotTurns()` before/after delta.

Previously both tokens and turns were read from the Hermes state DB
after the ACP prompt returned, but due to WAL write lag the DB often
had incomplete token data at read time (e.g. 235 vs actual 26,080).
