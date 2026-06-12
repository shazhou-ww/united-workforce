---
scenario: "thread-cancel-status.test.ts cleans up tmpdir and env after each test"
feature: test
tags: [test-infrastructure, cleanup, thread-cancel-status]
---

## Given

- `packages/cli/src/__tests__/thread-cancel-status.test.ts` exists
- The file currently has NO `afterEach` block and NO cleanup of any kind
- Each test creates a tmpdir via `mkdtemp` and calls `makeUwfStore` which sets `process.env.OCAS_HOME`

## When

- Each test in `thread-cancel-status.test.ts` completes (pass or fail)

## Then

- An `afterEach` block exists that:
  1. Restores `process.env.OCAS_HOME` to its original value (or deletes it if originally unset)
  2. Removes the tmpdir via `rm(tmpDir, { recursive: true, force: true })`
- No tmpdir files accumulate in the OS temp directory after repeated test runs
- `process.env.OCAS_HOME` is NOT left pointing to a random tmpdir path after the test file finishes
- The file uses the centralized `makeUwfStore` from `./thread-test-helpers.js` instead of its own local copy
