---
scenario: "vitest globalSetup detects OCAS_HOME or UWF_HOME env var leaks between test files"
feature: test
tags: [test-infrastructure, env-isolation, vitest, globalSetup]
---

## Given

- The monorepo has a vitest globalSetup file (e.g. `packages/cli/vitest.global-setup.ts`)
- The vitest config for `packages/cli` references this globalSetup
- `process.env.OCAS_HOME` and `process.env.UWF_HOME` are either unset or have their original values before the test suite starts

## When

- A test file sets `process.env.OCAS_HOME` to a tmpdir path but fails to restore it in afterEach
- The test suite completes (all files run)

## Then

- The globalSetup's teardown function checks whether `OCAS_HOME` or `UWF_HOME` changed from their pre-suite values
- If either env var was mutated (set to a different value than before the suite started, or set when it was previously unset), the teardown logs a warning identifying the leak
- The safety net is passive (warns, does not fail the suite) — it exists to catch regressions, not to block CI
- The globalSetup captures the original env values in its setup phase and compares in its teardown phase
