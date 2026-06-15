---
scenario: "After cleanup, repo-wide build, test, and check commands all pass green"
feature: cleanup
tags: [phase4, cleanup, acceptance, ci]
---

## Given
- The cleanup branch `fix/381-cleanup-adapter-packages` has applied all of the following:
  - `packages/agent-hermes`, `packages/agent-claude-code`, `packages/agent-sumeru` moved to `legacy-packages/`.
  - `packages/util-agent` trimmed to the still-used surface (or fully archived if no users remain).
  - `CLAUDE.md` Monorepo Structure section updated.
  - `packages/util/src/usage-reference.ts` and `packages/util/src/adapter-developing-reference.ts` updated to broker-based content.
  - `packages/cli/src/commands/setup.ts` and `prompt.ts` no longer mention legacy adapter binaries.
  - `scripts/publish-all.mjs` `publishOrder` updated.
- A clean `pnpm install` has been run from the repo root.

## When
- The maintainer runs the three acceptance commands in sequence from the repo root:
  ```bash
  pnpm run build
  pnpm run test
  pnpm run check
  ```
  …and additionally `pnpm run typecheck`.

## Then
- `pnpm run build` exits 0 with no `tsc` errors and produces `dist/` for every active package under `packages/*`.
- `pnpm run typecheck` exits 0 with no `tsc --build` errors.
- `pnpm run test` exits 0; every active package's vitest suite reports `Test Files  X passed` with `0 failed`. The previously-archived adapter test files do NOT run (they live in `legacy-packages/` which is outside the workspace).
- `pnpm run check` exits 0 — biome reports no lint errors and `scripts/lint-log-tags.sh` reports no duplicate or malformed log tags.
- `git status` shows no leftover `packages/agent-hermes`, `packages/agent-claude-code`, or `packages/agent-sumeru` directories, and `git diff --stat origin/main..HEAD` shows the moves and edits described above.
