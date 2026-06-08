---
"@united-workforce/util-agent": patch
"@united-workforce/agent-claude-code": patch
"@united-workforce/agent-hermes": patch
---

refactor(util-agent): hoist `buildSuspendOutput` into `util-agent`

The `buildSuspendOutput(reason)` helper that produces the `$SUSPEND` frontmatter
wire format was duplicated in both `agent-claude-code` and `agent-hermes`. Extract
it into `@united-workforce/util-agent` (next to `trySuspendFastPath`) so the
producer and consumer of the suspend wire format live in one place. Both adapters
now import it; the obsolete local copies and now-unused `SUSPEND_STATUS` imports
are removed. No user-visible behavior change.
