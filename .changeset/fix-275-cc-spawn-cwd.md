---
"@united-workforce/agent-claude-code": patch
---

Pass `cwd` to Claude Code `spawn()` so it starts in the correct worktree directory instead of inheriting from the parent process.
