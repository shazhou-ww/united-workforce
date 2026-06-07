# @united-workforce/agent-hermes

## 0.1.5 — 2026-06-07

- fix: decouple session resume from isFirstVisit guard
  
  When frontmatter validation fails, the step is never written to CAS, so isFirstVisit remains true on the next run. Both adapters now always check the session cache regardless of isFirstVisit. When resuming after a frontmatter-only failure (isFirstVisit + cache hit), a minimal correction prompt is sent via buildFrontmatterRetryPrompt() instead of re-sending the full initial prompt.

## 0.1.1

### Patch Changes

- 8085d1d: fix: read token usage from ACP PromptResponse instead of DB

  Token counts (inputTokens, outputTokens) now come from the ACP
  `PromptResponse.usage` field, which is populated synchronously from
  `run_conversation()` return data — no WAL race condition.

  Turns (assistant message count) still come from the DB via
  `snapshotTurns()` before/after delta.

  Previously both tokens and turns were read from the Hermes state DB
  after the ACP prompt returned, but due to WAL write lag the DB often
  had incomplete token data at read time (e.g. 235 vs actual 26,080).
