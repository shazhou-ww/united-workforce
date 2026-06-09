---
"@united-workforce/agent-claude-code": patch
---

fix: report correct numTurns and duration in CC adapter (#220)

- `assembleResult()` now uses `state.turns.length` (actual parsed streaming
  turns) instead of `resultLine.num_turns` (which CC reports as last-turn-only,
  always 1)
- `processClaudeOutput()` now uses wall-clock elapsed time instead of
  `parsed.durationMs` from the result line (which is also last-turn-only)
- Token usage (`inputTokens`/`outputTokens`) still comes from the result line —
  CC's streaming events do not include per-turn token counts, so there is no
  cumulative source available
