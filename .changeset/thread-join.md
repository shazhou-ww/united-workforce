---
"@united-workforce/cli": minor
---

feat: add `uwf thread join <thread-id>` command

Blocks until a running thread finishes, then returns the final result in the
same `StepOutput[]` format as `uwf thread exec`. Supports `--timeout <seconds>`
to abort the wait.

Fixes #365
