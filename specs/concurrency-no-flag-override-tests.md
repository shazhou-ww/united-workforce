---
scenario: "No test coverage exists for --max-concurrent flag override behavior"
feature: thread
tags: [concurrency, test, cleanup]
---

## Given
- `packages/cli/src/__tests__/concurrency.test.ts` exists

## When
- The test file is inspected

## Then
- There is no `describe` block named "resolveMaxRunning respects --max-concurrent flag"
- There is no test that passes a `flagValue` argument to `resolveMaxRunning`
- All remaining concurrency tests cover: config-based resolution, default value, slot acquisition/release, stale cleanup, race protection, and signal cleanup
