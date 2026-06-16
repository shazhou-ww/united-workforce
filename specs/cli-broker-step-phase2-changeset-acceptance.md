---
scenario: "issue #398 ships as a single-package @united-workforce/cli: minor changeset, with CI green and all four acceptance steps passing"
feature: thread
tags: [cli, broker-step, turns, changeset, acceptance, ci, phase2, "398"]
---

## Given
- Phase 2 of the realtime-turns RFC (`docs/rfc-realtime-turns.md`), issue #398. The change is
  **scoped to one package**: `@united-workforce/cli` (`packages/cli/src/commands/broker-step.ts`
  + `packages/cli/src/store.ts`). Phase 1 (`@united-workforce/broker`, #397) is already merged and
  released; no broker / protocol / sumeru edits are part of #398.
- The repo's release process uses changesets (`.changeset/*.md`), consistent with existing entries
  like `.changeset/397-broker-per-turn-callback.md` and `.changeset/392-step-show-metadata.md`.
- Issue #398's "验证完成标准": all four test-step checkboxes ticked, CI build green, and a
  changeset of `@united-workforce/cli: minor`.

## When
- The #398 work is completed across the three behavior specs
  (`cli-broker-step-active-turns-realtime.md`, `cli-broker-step-solidify-detail-turns.md`,
  `cli-broker-step-crash-rerun-clears-active-var.md`, plus the integration spec
  `cli-broker-step-cross-process-visibility.md`), and a changeset file is added under `.changeset/`.

## Then
- A changeset file exists under `.changeset/` (e.g. `398-realtime-turns-phase2.md`) whose
  frontmatter bumps **exactly one** package:
  ```markdown
  ---
  "@united-workforce/cli": minor
  ---
  ```
  - It is `minor` (additive: active-var accumulation + multi-turn detail solidification), not
    `patch` or `major`.
  - **No other package** appears in the changeset frontmatter (single-package change). In
    particular `@united-workforce/broker` is **absent** (its Phase 1 bump already shipped).
  - The body references the issue (e.g. `Fixes #398`) and summarizes the behavior: broker-step now
    accumulates each assistant turn into `@uwf/active-turns/<threadId>/<role>` in real time and, on
    completion, solidifies the full list into the immutable `detail.turns` (with
    `detail.turnCount = turns.length`, no longer hardcoded to `1`) and deletes the active var.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` are all green from the repo root
  (CI passes), and `npx vitest run packages/cli -t "active-turns"` passes the Step 1–3 unit tests.
- The four acceptance steps from issue #398 are all satisfied:
  - **Step 1** — active var grows 1→2→3 (`cli-broker-step-active-turns-realtime.md`).
  - **Step 2** — completion solidifies `detail.turns.length === 3`, `detail.turnCount === 3`,
    active var deleted (`cli-broker-step-solidify-detail-turns.md`).
  - **Step 3** — crash-rerun drops stale turns; detail holds only the new 3
    (`cli-broker-step-crash-rerun-clears-active-var.md`).
  - **Step 4** — cross-process visibility of the in-flight turn list via the SQLite-backed active
    var (`cli-broker-step-cross-process-visibility.md`).

## Notes
- `detail.turnCount` changing from a constant `1` to `turns.length` is a behavior change in the
  CLI's persisted detail shape, but it does **not** require a `DETAIL_SCHEMA` change (the schema
  already types `turnCount: integer` and `turns: ocas_ref[]`) — hence `minor`, not `major`.
- Scope guard for the implementer/tester: do **not** add a `@united-workforce/broker` or
  `@sumeru/server` bump for #398 — those belong to Phase 1 (done) and Phase 3 (separate issue).
