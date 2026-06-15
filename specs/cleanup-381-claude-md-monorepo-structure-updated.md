---
scenario: "CLAUDE.md monorepo structure section reflects post-cleanup layout"
feature: cleanup
tags: [phase4, cleanup, docs, claude-md]
---

## Given
- The current `CLAUDE.md` "Monorepo Structure" tree (lines ~22–37) lists `agent-hermes/`, `agent-claude-code/` as part of `packages/` and describes the dependency layer as `protocol → util → util-agent → agent-hermes / agent-claude-code / agent-builtin / cli`.
- After the cleanup, those adapter packages no longer live under `packages/` — they have moved to `legacy-packages/` and the dependency layer is rooted in `broker` instead.

## When
- The maintainer edits `CLAUDE.md` to describe the new monorepo structure and dependency layers.

## Then
- `grep -E 'agent-hermes/|agent-claude-code/|agent-sumeru/' CLAUDE.md` returns no match inside the `packages/` listing block (only inside `legacy-packages/` if mentioned at all).
- The Monorepo Structure tree lists, under `packages/`, exactly the active workspace packages: `protocol/`, `util/`, `util-agent/`, `broker/`, `agent-builtin/`, `agent-mock/`, `cli/`, `dashboard/`, `eval/` (each followed by a one-line description).
- The dependency layer description reads (or semantically equivalent): `protocol → util → util-agent → broker → agent-builtin / agent-mock / cli`. It must NOT include `agent-hermes`, `agent-claude-code`, or `agent-sumeru` in the active-layer chain.
- The Key Terms table's `Agent` row no longer says "An external CLI command (`uwf-hermes`, etc.) spawned by `uwf thread step`"; it instead describes agents as Sumeru-hosted sessions reached via broker (with `agent-builtin` as the local in-process exception).
