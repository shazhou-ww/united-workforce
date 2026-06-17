---
scenario: "CLI integration test for `uwf step turns` via subprocess with recurring role scenario"
feature: step
tags: [step-turns, cli, integration, subprocess, recurring-role, issue-423]
---

## Given

- A temporary CAS store and workflow registry
- A registered workflow with roles: developer, reviewer
- A thread with the following step chain (recurring role scenario):
  - developer (round 1) - completed, 2 turns
  - reviewer - completed, 2 turns
  - developer (round 2) - completed, 3 turns
- The thread is fully completed (not in-flight)
- The `uwf` CLI binary is built and available at `packages/cli/dist/cli.js`

## When

- Invoke `uwf step turns <thread-id>` via `execFileSync` subprocess call
- Use `--format raw-json` or text output mode
- Pass `UWF_HOME` and `OCAS_HOME` environment variables pointing to the temp store

## Then

- Exit code is 0 (success)
- Output contains 3 step groups in chronological order:
  1. `## developer` (round 1) with 2 turns
  2. `## reviewer` with 2 turns
  3. `## developer` (round 2) with 3 turns
- Both developer segments are present (NOT collapsed into one)
- Each segment's turns are correctly attributed (no cross-segment leakage)
- All 7 turns are rendered with global numbering (Turn 1 through Turn 7)
- No argument parsing errors occur
- Output formatting matches the function-level test expectations

## Notes

- This test exercises the full CLI command invocation path, catching:
  - Argument parsing regressions (yargs configuration)
  - Output formatting issues at the command boundary
  - Environment variable handling
  - Exit code behavior
- The existing function-level tests (`step-turns.test.ts`, `step-turns-panorama-phase3.test.ts`) verify `cmdStepTurns` directly but don't test the CLI wrapper
- The recurring role scenario (developer -> reviewer -> developer) is critical because it exposed the #412 bug and is the most likely to regress
