---
"@united-workforce/cli": minor
"@united-workforce/util": patch
---

feat(cli): add `uwf step ask <step-hash> -p <prompt>` read-only follow-up command

Phase 2b of the ask-session work. Adds a new subcommand that lets the user ask
a follow-up question to a historical step's agent without writing a new
`StepNode` or mutating thread state. The command resolves the agent from the
recorded step (or `--agent <cmd>` override), forks the original session via the
adapter's `--mode fork --session <source>` contract, caches the resulting
ask-session id under `<stepHash>:ask` so subsequent asks reuse it, then invokes
the agent with `--mode ask --session <forkId> --prompt <text> --detail <ref>`
and streams the raw stdout to the caller. `--no-fork` falls back to a fresh
session that receives the step's detail ref for context. The `prompt usage`
reference (in `@united-workforce/util`) is also updated so agents discover the
new subcommand. Resolves issue #146.
