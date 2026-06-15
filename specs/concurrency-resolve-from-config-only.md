---
scenario: "resolveMaxRunning reads only from config — no CLI flag override path"
feature: thread
tags: [concurrency, config, cleanup]
---

## Given
- `resolveMaxRunning` function in `packages/cli/src/commands/thread.ts`
- `concurrency.maxRunning` is set to 3 in `~/.uwf/config.yaml`

## When
- `resolveMaxRunning(storageRoot)` is called (single argument, no flagValue parameter)

## Then
- The function signature accepts only `storageRoot: string` — no `flagValue` parameter
- Returns 3 (the config value)
- There is no code path that accepts a CLI flag override
- `cmdThreadExec` does not pass any `maxConcurrent` argument to `resolveMaxRunning`
