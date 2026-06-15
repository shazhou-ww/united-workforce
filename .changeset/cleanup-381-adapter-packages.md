---
"@united-workforce/util": minor
"@united-workforce/util-agent": minor
"@united-workforce/cli": patch
"@united-workforce/eval": patch
---

chore(cleanup): archive legacy per-agent CLI adapters (#381)

Phase 4 cleanup of the broker rollout. The per-agent CLI binary packages
(`agent-hermes`, `agent-claude-code`, `agent-sumeru`) have moved out of
`packages/` into `legacy-packages/` and are no longer published — Sumeru
gateways are now reached through `@united-workforce/broker` over HTTP.

- `@united-workforce/util-agent` public surface trimmed to the symbols
  still consumed by `cli`, `broker`, `agent-builtin`, and `agent-mock`.
  The per-agent SQLite session cache, external-CLI continuation prompt
  builder, thread-progress hint, `buildContext`, `buildSuspendOutput`,
  the argv parser, and the fork/cleanup adapter type aliases are no
  longer exported (they live in the archived adapters).
- `@united-workforce/util` skill references (`uwf prompt usage` and
  `uwf prompt adapter-developing`) rewritten so the rendered SKILL.md
  describes the broker-based architecture instead of recommending
  per-agent CLI binary installs.
- `@united-workforce/cli` setup/prompt commands no longer scan for or
  recommend the per-agent CLI binaries; the `setup --agent` option
  description in `cli.ts` was also updated so `uwf setup --help`
  contains no legacy adapter substrings.
- `@united-workforce/eval`'s `eval run --agent` default flipped from
  the now-archived `uwf-hermes` to `uwf-builtin` so the default flow
  stays runnable post-cleanup.
- `scripts/publish-all.mjs` `publishOrder` updated to drop legacy
  adapter dirs and use the post-rename workspace package directories.
- Repo-root `vitest.config.ts` excludes `legacy-packages/**` so archived
  adapter test files do not run in the workspace test pass.
- Top-level `README.md` Architecture / Packages sections rewritten to
  match the post-cleanup layout (broker added to Layer 3, archived
  adapters moved into a dedicated Archived table that links into
  `legacy-packages/`). `legacy-packages/agent-sumeru/CHANGELOG.md`
  added so all three archived packages carry the same banner.
