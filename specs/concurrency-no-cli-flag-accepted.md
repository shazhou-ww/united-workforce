---
scenario: "uwf thread exec does not accept --max-concurrent flag"
feature: thread
tags: [concurrency, cli, cleanup]
---

## Given
- The `uwf thread exec` command definition in `packages/cli/src/cli.ts`
- A thread `T` in idle state

## When
- `uwf thread exec <T> --max-concurrent 4` is run

## Then
- The command rejects the unknown option `--max-concurrent` (Commander unknown-option error)
- No `maxConcurrent` variable is parsed or passed to `cmdThreadExec`
- The `.option("--max-concurrent <number>", ...)` line does not exist in cli.ts
