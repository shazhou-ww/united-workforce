---
"@united-workforce/protocol": minor
"@united-workforce/cli": minor
"@united-workforce/agent-claude-code": minor
"@united-workforce/agent-hermes": minor
---

feat(workflow)!: `$SUSPEND` becomes an engine-level reserved `$status` (coroutine yield)

`$SUSPEND` is no longer a graph pseudo-role. Instead, any role may emit
`{ $status: "$SUSPEND", reason: string }` from its output. The engine intercepts
this status before the moderator: the step is written to CAS normally (head
advances), the thread is marked `suspended` with the role and reason, and
`thread resume` re-runs the same role — exactly like a coroutine yielding control
back to its caller.

For any role with frontmatter type `F`, the effective output type is
`F | { $status: "$SUSPEND", reason: string }`. Suspend outputs are validated
against a dedicated reserved schema, bypassing the role's own frontmatter schema.

Adapters now yield instead of failing on resource limits:
- `agent-claude-code`: an `error_max_turns` result emits `$SUSPEND` (preserving
  all turns and usage) instead of throwing.
- `agent-hermes`: a prompt timeout emits `$SUSPEND` instead of rejecting.

BREAKING CHANGE: `"$SUSPEND"` is removed from `GraphPseudoRole` and is no longer a
valid graph target role. Workflows using the old `role: "$SUSPEND"` edge pattern
now fail validation with a migration hint — emit `$status: "$SUSPEND"` from the
role output instead.
