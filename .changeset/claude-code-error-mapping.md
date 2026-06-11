---
"@united-workforce/agent-claude-code": patch
---

Fix unclear error from `uwf-claude-code` when the `claude` subprocess fails (e.g. user not logged in). The adapter now captures stderr and maps known patterns to actionable messages: `Not logged in` → `Claude Code is not logged in. Run \`claude login\` first.`, API key errors → `Claude Code API key error. Check your API key configuration.`, generic non-zero exits → `claude exited with code <n>: <truncated stderr>`. Demoted the full assembled prompt log (tag `K7R2M4N8`) to a short summary (role + length); the full prompt body is now only emitted when `UWF_DEBUG=1` is set, so prompt content no longer leaks into normal stderr or error messages. Closes #301.
