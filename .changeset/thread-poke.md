---
"@united-workforce/cli": minor
---

feat(cli): add `uwf thread poke` command

New subcommand `uwf thread poke <thread-id> -p <prompt>` re-runs the head step's
agent with a supplementary prompt, replacing the head step's output. Unlike
`thread resume`, poke skips the moderator and rewrites the new step's `prev`
pointer so the new head replaces (not appends to) the old head. Works on idle
and suspended threads. Resolves issue #144 (Phase 1).
