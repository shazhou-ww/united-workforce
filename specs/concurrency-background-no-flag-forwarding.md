---
scenario: "cmdThreadStepBackground does not forward any concurrency flag to spawned worker"
feature: thread
tags: [concurrency, background, cleanup]
---

## Given
- `cmdThreadStepBackground` function in `packages/cli/src/commands/thread.ts`
- A thread `T` in idle state
- `--background` mode is used

## When
- `uwf thread exec <T> --background` spawns a background worker process

## Then
- The spawned worker args do NOT contain `--max-concurrent` or any concurrency flag
- `cmdThreadStepBackground` does not accept a `maxConcurrent` parameter
- The background worker resolves concurrency limit solely from config (via `resolveMaxRunning(storageRoot)`)
