---
scenario: "Old adapter binary packages (hermes, claude-code, sumeru) are moved out of packages/ into legacy-packages/"
feature: cleanup
tags: [phase4, cleanup, legacy, monorepo]
---

## Given
- The repo currently exposes three adapter binary packages under `packages/`:
  - `packages/agent-hermes/` (publishes binary `uwf-hermes`)
  - `packages/agent-claude-code/` (publishes binary `uwf-claude-code`)
  - `packages/agent-sumeru/` (publishes binary `uwf-sumeru`)
- Phase 3 (issue #380) has already shipped `@united-workforce/broker` and wired `uwf thread exec` to call broker — these legacy adapter binaries are no longer the primary execution path.
- `packages/agent-builtin/` and `packages/agent-mock/` remain active (in-process / test fixtures, not subject to this cleanup).

## When
- The maintainer runs `git mv packages/agent-hermes legacy-packages/agent-hermes`, the equivalent move for `packages/agent-claude-code` and `packages/agent-sumeru`, and adjusts `pnpm-workspace.yaml` so that `packages/*` still globs cleanly (legacy packages are not part of the workspace).

## Then
- `ls packages/` prints exactly: `agent-builtin  agent-mock  broker  cli  dashboard  eval  protocol  util  util-agent` — no `agent-hermes`, `agent-claude-code`, or `agent-sumeru` directories remain under `packages/`.
- `ls legacy-packages/` contains the three moved directories `agent-hermes/`, `agent-claude-code/`, `agent-sumeru/` (each with original `package.json`, `src/`, `__tests__/`, `README.md`, `CHANGELOG.md` preserved).
- `pnpm-workspace.yaml` continues to use `packages: ['packages/*']` so legacy packages are NOT included in the workspace and not discovered by `pnpm install` / `pnpm run build`.
- `pnpm install` from the repo root succeeds and does NOT attempt to link `@united-workforce/agent-hermes`, `@united-workforce/agent-claude-code`, or `@united-workforce/agent-sumeru` into `node_modules/.bin`.
