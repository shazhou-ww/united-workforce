---
scenario: "Issue #409 ships the chain-panorama step turns as a discoverable command: --limit/--offset are registered with help text, README documents the whole-thread panorama + 进行中 marker + pagination, and a changeset bumps every affected published package (@united-workforce/cli: minor, plus @united-workforce/util: patch if reference text regenerates)"
feature: step
tags: [cli, step-turns, docs, help, changeset, acceptance, chain, "409", "400"]
---

## Given
- Issue #409, constraint: "changeset：@united-workforce/cli: minor" and "main 走
  PR". The behavioural change is the whole-chain panorama
  (`step-turns-chain-panorama.md`) plus the new `--limit`/`--offset` pagination
  flags (`step-turns-pagination.md`); this spec captures the **non-functional**
  acceptance gates (CLI help, README, changeset, CI green).
- The CLI uses commander: `step turns` is declared under `program.command("step")`
  in `packages/cli/src/cli.ts` with `<thread-id>`, `--role <role>`, and `--live`,
  each surfaced by `uwf step turns --help`. #409 adds `--limit <n>` and
  `--offset <n>` options to the same declaration.
- The repo documents the `workflow → thread → step → turn` layering (README,
  `cli.ts` help banner). The published `@united-workforce/util` package carries
  generated CLI/usage reference text (`packages/util/src/cli-reference.ts`,
  `packages/util/src/usage-reference.ts`); when the `step turns` help/usage text
  changes, that generated text is regenerated and ships inside a `util` release.
- A changeset must cover **every** published package whose source the PR changes
  (affected-package coverage). For #409 that is at minimum `@united-workforce/cli`
  (the command behaviour + new flags), and `@united-workforce/util` (patch) **iff**
  the regenerated reference text changes.

## When
- The user discovers and reads help for the command:
  ```bash
  uwf step --help          # lists `turns` among list/show/read/fork
  uwf step turns --help    # shows <thread-id>, --role, --live, --limit, --offset
  ```
- CI runs `pnpm run build` / `pnpm run check` / `pnpm run test` on the branch.

## Then
- The `step turns` subcommand registration in `cli.ts` gains the pagination
  options:
  - positional `<thread-id>` (a `ThreadId`),
  - `--role <role>` (now a chain-wide role filter, not a single-var selector),
  - `--live` boolean flag,
  - **`--limit <n>`** and **`--offset <n>`** options (the `ListOptions`
    vocabulary), with help text describing pagination over the flattened turn
    sequence,
  - a `.description(...)` updated to reflect the new semantics — a whole-thread
    turn panorama across all steps (e.g. "Show all turns across a thread's steps,
    marking the in-progress step; --live follows it"), no longer "read **a**
    step's turns from the active var".
  `uwf step turns --help` prints `<thread-id>` and the `--role` / `--live` /
  `--limit` / `--offset` options.
- **README** is updated so the turn-layer documentation matches the new
  behaviour: `uwf step turns <thread-id> [--role <r>] [--live] [--limit <n>]
  [--offset <m>]` shows **every step's turns along the thread chain** (each turn
  attributed to its role/step), marks the in-flight step **`🔄 进行中`** and
  completed steps `✓`, shows **all turns by default**, and paginates with
  `--limit`/`--offset`. Any prior wording implying it shows only the latest/head
  step's turns is corrected.
- A changeset file exists under `.changeset/` whose front block bumps the
  affected published package(s):
  ```markdown
  ---
  "@united-workforce/cli": minor
  ---
  ```
  - `@united-workforce/cli`: **minor** — `step turns` now renders the whole-chain
    panorama with the 进行中 marker and adds `--limit`/`--offset` pagination
    (additive, backward-compatible command surface).
  - `@united-workforce/util`: **patch** — **only if** the regenerated
    `cli-reference.ts` / `usage-reference.ts` text changes (new `--limit`/
    `--offset` entries); include it when the build regenerates that text, omit it
    if unchanged. The rule is: every changed published package appears, none whose
    source is unchanged is bumped.

  The body describes the chain-panorama behaviour and references #409 (and the
  #408/#400 lineage it supersedes).
- **CI green**: `pnpm run build` (tsc composite) succeeds, `pnpm run check`
  (Biome + log-tag lint) reports no errors on new/edited files, and
  `pnpm run test` (vitest) passes — **including** the new #409 tests: the
  multi-step chain-panorama traversal, the `--role developer` regression
  (returns the developer step's turns, not empty), per-step active→detail
  sourcing, the `--limit`/`--offset` slice math, and the boundary cases (empty
  thread, `turnCount === 0` step).

## Notes
- This captures issue #409's non-behavioural completion gates (docs + changeset +
  CI) so the testing checklist is fully covered by specs; the behavioural
  contracts live in the sibling `step-turns-*` specs
  (`step-turns-chain-panorama.md`, `step-turns-role-selection.md`,
  `step-turns-read-order-active-then-detail.md`, `step-turns-pagination.md`,
  `step-turns-live-poll-active-var.md`).
- Convention parity: keep the new flag help wording consistent with existing
  `step` subcommand entries so `uwf step --help` reads coherently; use the
  `--limit`/`--offset` names verbatim from the repo-wide `ListOptions` convention
  rather than inventing new pagination flags.
- New logging at any added call sites must use the structured `log(tag, msg)`
  helper with a fresh unique 8-char Crockford Base32 tag (CLAUDE.md), not
  `console.*` (the CLI user-facing-output exception still applies to result
  printing only).
