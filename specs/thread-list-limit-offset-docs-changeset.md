---
scenario: "Issue #451 ships thread list --limit/--offset as a discoverable, documented command surface: the flags are registered with help text, THREAD_LIST_HELP + README + util reference text list them alongside (or in place of) --skip/--take, and a changeset bumps every affected published package"
feature: thread
tags: [cli, thread-list, docs, help, changeset, acceptance, "451"]
---

## Given
- Issue #451's behavioural change is `thread list --limit/--offset` pagination
  (`thread-list-limit-offset-pagination.md`); this spec captures the
  **non-functional** acceptance gates: CLI help, README, generated reference
  text, changeset, and CI green.
- The CLI uses cli-kit. `thread list` is registered under the `thread` command
  in `packages/cli/src/cli.ts` with `--status`, `--all`, `--after`, `--before`,
  `--skip`, `--take`. The static help string `THREAD_LIST_HELP` (same file)
  documents those options. #451 adds `--limit <n>` and `--offset <m>` to both
  the registration and the help string.
- Generated reference text lives in the published `@united-workforce/util`
  package: `packages/util/src/cli-reference.ts` and
  `packages/util/src/usage-reference.ts` (the latter currently lists
  `--skip <n>` / `--take <n>` under `thread list`). `packages/cli/README.md`
  documents `uwf thread list [...] [--skip <n>] [--take <n>]` and an example
  `uwf thread list --after 7d --take 10`.
- A changeset must cover **every** published package whose source the PR
  changes: at minimum `@united-workforce/cli` (the command behaviour + new
  flags), plus `@united-workforce/util` (patch) **iff** the regenerated
  reference text changes.

## When
- The user discovers and reads help for the command:
  ```bash
  uwf thread --help          # lists `list` among the thread subcommands
  uwf thread list --help     # shows --status/--all/--after/--before/--limit/--offset
  uwf help thread list       # same static THREAD_LIST_HELP text
  ```
- CI runs `pnpm run build` / `pnpm run check` / `pnpm run test` on the branch.

## Then
- **Flag registration + help**: the `thread list` registration in `cli.ts` gains
  `--limit <n>` and `--offset <m>`, and `THREAD_LIST_HELP` lists them with
  descriptions consistent with the existing entries, e.g.:
  ```
  --limit <n>    Return at most n threads (newest first)
  --offset <m>   Skip the first m threads
  ```
  Because `--skip`/`--take` are retained as backward-compatible aliases
  (`thread-list-limit-offset-pagination.md`), the help may either (a) document
  `--limit`/`--offset` as canonical and keep `--skip`/`--take` listed, or
  (b) present `--limit`/`--offset` as canonical and drop `--skip`/`--take` from
  the help text while still accepting them. Whichever is chosen, `--limit`/
  `--offset` MUST appear in `uwf thread list --help`.
- **README**: `packages/cli/README.md`'s `thread list` row documents the new
  `--limit`/`--offset` pagination (e.g.
  `uwf thread list [--status <status>] [--all] [--after <date>] [--before <date>] [--limit <n>] [--offset <m>]`),
  and the usage example reads in the canonical vocabulary
  (e.g. `uwf thread list --after 7d --limit 10`). Any wording is consistent with
  `step turns` using the same `--limit`/`--offset` names.
- **Generated reference text**: `packages/util/src/usage-reference.ts` (and
  `cli-reference.ts` if it enumerates the flags) is regenerated so the
  `thread list` block lists `--limit`/`--offset` (matching the `step turns`
  entries). The committed source and its `dist/` build agree (no drift).
- **Changeset**: a file under `.changeset/` bumps the affected published
  package(s):
  ```markdown
  ---
  "@united-workforce/cli": minor
  ---
  ```
  - `@united-workforce/cli`: **minor** — `thread list` gains `--limit`/`--offset`
    pagination (additive, backward-compatible command surface).
  - `@united-workforce/util`: **patch** — **only if** the regenerated
    `usage-reference.ts` / `cli-reference.ts` text changes; include it when the
    build regenerates that text, omit it if unchanged. Rule: every changed
    published package appears; none whose source is unchanged is bumped.

  The body describes the new pagination flags and references #451.
- **CI green**: `pnpm run build` (tsc composite) succeeds, `pnpm run check`
  (Biome + log-tag lint) reports no errors on new/edited files, and
  `pnpm run test` (vitest) passes — including the new #451 `thread list`
  `--limit`/`--offset` test(s) and the **unchanged** existing
  `cmdThreadList pagination` tests (`--skip`/`--take`).

## Notes
- This captures issue #451's non-behavioural completion gates (help + docs +
  reference text + changeset + CI) so the testing checklist is fully covered;
  the behavioural contract lives in `thread-list-limit-offset-pagination.md`.
- Convention parity: use the `--limit`/`--offset` names verbatim from the
  repo-wide `ListOptions` vocabulary (as `step turns` does), rather than
  inventing new pagination flags or leaving `thread list` on a different
  `--skip`/`--take`-only vocabulary than the rest of the CLI.
- Keep the help wording for the new flags consistent with the existing
  `THREAD_LIST_HELP` entries so `uwf thread list --help` reads coherently.
