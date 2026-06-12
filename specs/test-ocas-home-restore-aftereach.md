---
scenario: "All test files that set OCAS_HOME restore it in afterEach so env does not leak to other test files"
feature: test
tags: [test-infrastructure, env-isolation, cleanup]
---

## Given

- A test file sets `process.env.OCAS_HOME` (either directly or via `makeUwfStore`)
- The original value of `OCAS_HOME` is saved before each test (in `beforeEach` or at describe scope)

## When

- Each test in the file completes (pass or fail)

## Then

- The `afterEach` block restores `process.env.OCAS_HOME` to its original value
- If `OCAS_HOME` was originally unset, `afterEach` deletes it (`delete process.env.OCAS_HOME`)
- The following previously-leaking files now have proper save/restore:
  - `thread-cancel-status.test.ts` (had NO afterEach at all)
  - `workflow-resolution.test.ts` (had afterEach with rm only, no env restore)
  - `workflow-list-recursive.test.ts` (had afterEach with rm only, no env restore)
  - `thread.test.ts` (had afterEach with rm only, no env restore)
  - `thread-list-filters.test.ts` (had afterEach with rm only, no env restore)
  - `thread-poke.test.ts` (set OCAS_HOME directly, no env restore)
  - `step-ask.test.ts` (set OCAS_HOME directly, no env restore)
  - `thread-resume.test.ts` (set OCAS_HOME directly, no env restore)
- Verification: `pnpm -C packages/cli run test` passes with no OCAS_HOME leak warnings from globalSetup
- Verification: `~/.ocas/` contains no new test-generated CAS nodes after a full test run
