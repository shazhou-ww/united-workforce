---
scenario: "BrokerTurn / onTurn / SendResult.turns are exported from the package public API and shipped with a minor changeset"
feature: broker
tags: [broker, public-api, exports, changeset, phase1, deliverable]
---

## Given
- Phase 1 introduces the `BrokerTurn` type and extends `SendArgs` / `SendResult`. Per the
  package's `Folder Module Discipline` (CLAUDE.md): types live in `types.ts`, each folder
  re-exports via `index.ts`, named exports only, import paths use `.js`.
- `packages/broker/src/send/index.ts` re-exports the `send` module's public types, and
  `packages/broker/src/index.ts` is the package barrel that re-exports them onward (this is the
  surface `__tests__/public-api.test.ts` pins).
- The repo uses `@changesets/cli`; changesets live in `.changeset/*.md` with a YAML header
  mapping package → bump level (see existing `.changeset/391-broker-sse-timeout-watchdog.md`).

## When
- A consumer imports from the package entrypoint:
  ```typescript
  import {
    type BrokerTurn,
    type SendArgs,
    type SendResult,
    createBroker,
  } from "@united-workforce/broker";
  ```
- And CI runs `pnpm run build`, `pnpm run check`, and `pnpm run test` at the repo root.

## Then
- `BrokerTurn` is exported from `packages/broker/src/send/index.ts` **and** from the package
  barrel `packages/broker/src/index.ts` (added to the existing `export type { ... } from
  "./send/index.js";` list), so `import { type BrokerTurn } from "@united-workforce/broker"`
  resolves.
- `SendArgs` now includes `onTurn: ((turn: BrokerTurn) => void) | null` and `SendResult` now
  includes `turns: readonly BrokerTurn[]`; both remain `Readonly<{...}>` with no optional `?:`
  fields (project convention — use `T | null`).
- `pnpm run build` (tsc composite) and `pnpm run check` (Biome) pass with no errors; `strict`
  mode is satisfied (no `any`, no unchecked index access introduced).
- The whole repo test run is green, including the existing `__tests__/public-api.test.ts` (updated
  if it enumerates exports) and the new Phase 1 tests covering Steps 1–3.
- A changeset file exists under `.changeset/` whose header bumps **only**:
  ```markdown
  ---
  "@united-workforce/broker": minor
  ---
  ```
  with a body describing the per-turn callback (`onTurn`) + `SendResult.turns` addition. It is a
  `minor` bump (additive, backward compatible), and no other package is bumped (Phase 1 is the
  single-package broker change; CLI integration is Phase 2).

## Notes
- This spec captures the cross-cutting deliverables from issue #397's "验证完成标准" (CI green +
  changeset) and the RFC Phase 1 delivery checklist, complementing the three behavioral specs
  (`broker-send-on-turn-callback.md`, `broker-send-result-turns-full.md`,
  `broker-send-on-turn-null-backward-compat.md`).
