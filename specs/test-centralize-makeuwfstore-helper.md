---
scenario: "makeUwfStore helper is centralized in thread-test-helpers.ts instead of being copy-pasted across test files"
feature: test
tags: [test-infrastructure, DRY, test-helpers]
---

## Given

- `packages/cli/src/__tests__/thread-test-helpers.ts` exists as the shared test helper module
- The helper exports a `makeUwfStore` function that:
  1. Creates a `cas/` subdirectory under the given `storageRoot`
  2. Sets `process.env.OCAS_HOME` to that `cas/` directory
  3. Calls `createUwfStore(storageRoot)` and returns the result

## When

- Any test file needs to create an isolated UwfStore backed by a tmpdir

## Then

- The test file imports `makeUwfStore` from `./thread-test-helpers.js` (not re-implementing it inline)
- The following files no longer contain a local `makeUwfStore` function definition:
  - `workflow-resolution.test.ts`
  - `workflow-list-recursive.test.ts`
  - `thread.test.ts`
  - `thread-cancel-status.test.ts`
  - `thread-list-filters.test.ts`
- Running `grep -r "async function makeUwfStore" packages/cli/src/__tests__/` returns exactly one match: `thread-test-helpers.ts`
