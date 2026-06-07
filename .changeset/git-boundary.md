---
"@united-workforce/cli": patch
---

fix: stop parent traversal at .git boundary

`findWorkflowInParents()` and `discoverProjectWorkflows()` now stop traversing
parent directories when they encounter a `.git` directory or file (git worktree).
This prevents picking up unrelated `.workflow/` directories above the repository
root in monorepo setups.
