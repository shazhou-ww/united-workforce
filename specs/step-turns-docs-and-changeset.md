---
scenario: "Phase 4 ships the turn-layer query as a discoverable command: uwf step turns is registered with help text, README/CLI help document the turn-layer query, and a @united-workforce/cli: minor changeset is added"
feature: step
tags: [cli, step-turns, docs, help, changeset, acceptance, phase4, "400"]
---

## Given
- Phase 4 of the realtime-turns RFC (`docs/rfc-realtime-turns.md`) and issue #400's completion
  criteria: **Step 3 — 文档更新** ("README/CLI help 更新，说明 turn 层查询能力"), plus
  "✅ CI 构建成功" and "✅ changeset：@united-workforce/cli: minor".
- The CLI uses commander: subcommands under `program.command("step")` are declared in
  `packages/cli/src/cli.ts` (e.g. the existing `step list` / `show` / `read` / `ask` / `fork`), each
  with a `.description(...)` surfaced by `uwf step --help`.
- The repo documents the `workflow → thread → step → turn` layering (see `cli.ts` help banner and
  `README.md`); turn is the established fourth layer, but before Phase 4 there was **no** CLI command
  to query it — `step read` renders a *completed* step's `detail.turns`, with no live / in-flight
  view.
- Changesets live in `.changeset/<name>.md` with a YAML front block naming the bumped package, e.g.
  `.changeset/398-realtime-turns-accumulation.md` →
  ```markdown
  ---
  "@united-workforce/cli": minor
  ---
  ```

## When
- The user discovers and reads help for the new command:
  ```bash
  uwf step --help          # lists the `turns` subcommand with its description
  uwf step turns --help    # shows usage: <thread-id>, --role <r>, --live
  ```
- CI runs `pnpm run build` / `pnpm run check` / `pnpm run test` on the branch.

## Then
- A `step turns` subcommand is **registered** under the `step` command group in `cli.ts` with:
  - positional `<thread-id>` (a `ThreadId`),
  - `--role <role>` option,
  - `--live` boolean flag,
  - a `.description(...)` that mentions reading a step's turns (e.g. "Read a step's turns live from
    the active var, falling back to the completed step detail").
  `uwf step --help` lists `turns` alongside `list`/`show`/`read`/`fork`, and `uwf step turns --help`
  prints the `<thread-id>` argument and the `--role` / `--live` options.
- **README** is updated to document the turn-layer query capability: the command-reference / step
  section gains an entry for `uwf step turns <thread-id> [--role <r>] [--live]` explaining it shows a
  running step's turns live (polling the active var) and falls back to the completed step's
  `detail.turns`. The `workflow → thread → step → turn` framing now has a user-facing command at the
  turn layer.
- A changeset file exists under `.changeset/` whose front block is exactly
  `"@united-workforce/cli": minor` and whose body describes the new `uwf step turns --live` consumer
  command (referencing #400). No other package is bumped by this change (single-package, cli-only).
- **CI green**: `pnpm run build` (tsc composite) succeeds, `pnpm run check` (Biome) reports no
  errors on the new/edited files, and `pnpm run test` (vitest) passes including the new
  `step turns` unit tests (`step-turns-read-order-active-then-detail.md`,
  `step-turns-role-selection.md`, `step-turns-live-poll-active-var.md`).

## Notes
- This spec captures the **non-functional** acceptance gates of issue #400 (Step 3 docs + changeset +
  CI) so the testing checklist is fully covered by specs; the behavioral contract lives in the three
  sibling `step-turns-*` specs.
- Convention parity: keep the new `step turns` help/description style consistent with the existing
  `step read` entry ("Read a step's turns as human-readable markdown") so `uwf step --help` reads
  coherently.
