---
"@united-workforce/util-agent": minor
"@united-workforce/agent-mock": patch
"@united-workforce/agent-builtin": patch
"@united-workforce/agent-hermes": patch
"@united-workforce/agent-claude-code": patch
---

feat(util-agent): extend AgentOptions with `fork` / `cleanup` and add ask-session cache

Phase 2a infrastructure for `step ask`. Extends `AgentOptions` with
`fork: AgentForkFn | null` and `cleanup: AgentCleanupFn | null` fields, exporting
the new `AgentForkFn` and `AgentCleanupFn` type aliases. Adds `getAskSessionId` /
`setAskSessionId` to the per-agent session cache, using `<stepHash>:ask` keys
that share the cache file with exec sessions (`<threadId>:<role>` keys) without
collision. All four adapters (mock, builtin, hermes, claude-code) now pass
`fork: null, cleanup: null` — real implementations land in Phase 2b. Resolves
issue #145.
