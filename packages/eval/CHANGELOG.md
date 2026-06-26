# @united-workforce/eval

## 0.2.0 — 2026-06-26

- fix(eval): clean up workDir after uwf-eval run + add --keep-workdir flag
- chore(cleanup): archive legacy per-agent CLI adapters (#381)
  
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

## 0.1.7

### Patch Changes

- Updated dependencies [aeb2449]
  - @united-workforce/protocol@0.4.0
  - @united-workforce/util@0.2.1

## 0.1.6 — 2026-06-12

- **BREAKING**: `uwf` CLI commands now emit ocas envelopes (`{ type, value }`) by default, with text rendering as the default format.

  Five output formats are supported via `--format`:

  | Format           | Shape                                          | Use case                                                       |
  | ---------------- | ---------------------------------------------- | -------------------------------------------------------------- |
  | `text` (default) | Liquid-rendered human-readable view            | Interactive terminal use                                       |
  | `json`           | `{"type": "<schemaHash>", "value": <payload>}` | Self-describing JSON for downstream parsers                    |
  | `yaml`           | YAML envelope (type, value keys)               | Self-describing YAML                                           |
  | `raw-json`       | bare `<payload>`                               | **0.5.0 backward compat** — drop-in replacement for old `json` |
  | `raw-yaml`       | bare `<payload>`                               | **0.5.0 backward compat** — drop-in replacement for old `yaml` |

  Migration: scripts that consumed `uwf ... --format json` (parsing the bare value) must switch to `--format raw-json` to preserve the previous output shape, or update their parsers to read from the `value` field of the envelope.

  New protocol exports:

  - `OUTPUT_SCHEMAS` map and individual `*_OUTPUT_SCHEMA` constants for the 9 CLI output schemas (thread-start, thread-status, thread-list, thread-exec, step-detail, step-list, workflow-detail, workflow-list, validate-result)
  - `OUTPUT_TEMPLATES` map and `outputSchemaVarName(name)` helper

  The CLI registers all output schemas and `@ocas/template/text/<schemaHash>` templates idempotently on first use via `registerUwfSchemas`.

  `uwf workflow validate` now emits a structured `validate-result` envelope on stdout (`✓ valid` / `✗ invalid (N errors)`) instead of writing errors to stderr; exit codes are preserved (0 for valid, 1 for invalid).

  **In-repo consumer migration** (`@united-workforce/eval` patch): the eval runner (`runner/execute.ts`) and the builtin judges (`judge/builtin/read-steps.ts`, `frontmatter.ts`, `token-stats.ts`) now invoke the CLI with `--format raw-json` and read the new payload field names (`threadId`, `workflowHash`, `items`, `steps`). The `step list` payload no longer contains a synthetic start entry, so the judges drop the legacy `.slice(1)` and fetch per-step `frontmatter`/`usage` via a follow-up `uwf step show <hash>` call. Repo helper scripts `scripts/e2e-walkthrough.sh` and `scripts/batch-solve.sh` were migrated in lockstep (jq/python paths updated to match the new payload shape).

## 0.1.2

### Patch Changes

- 850a3b2: fix: resolve --agent override via config alias before raw command

  `resolveAgentConfig()` now checks `config.agents[alias]` first before falling back to `parseAgentOverride()`. Eval CLI default `--agent` changed from `"hermes"` to `"uwf-hermes"`.
