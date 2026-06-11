---
scenario: "Switching the default format and json shape from bare value to envelope is documented as a breaking change for 0.x consumers"
feature: cli
tags: [cli, breaking, compat, format, raw-json]
---

## Background

Issue #308 is intentionally a breaking change for two stdout contracts that
existing scripts may rely on:

1. **The default output is no longer JSON.** Running `uwf thread show <id>`
   without `--format` previously printed bare-value JSON; it now prints
   human-readable text via `ocas render`.
2. **`--format json` no longer prints a bare value.** It now prints an
   envelope `{ type: <hash>, value: <payload> }`. Scripts that did
   `uwf … --format json | jq .threadId` need to become
   `uwf … --format json | jq .value.threadId` or switch to
   `--format raw-json`.

The compatibility escape hatch is the new `raw-json` and `raw-yaml`
formats, which preserve the *exact* byte-for-byte 0.5.0 output of the
previous `json` and `yaml` flags. This spec captures the contract.

Per `CLAUDE.md` — workflow project rules — the `0.x` versioning policy
treats breaking changes as a minor bump, and a changeset is required.

## Given
- The repository is on a 0.x version (e.g. 0.5.0 → 0.6.0 bump)
- A changeset under `.changeset/` documents the breaking change and lists
  affected commands (`thread start`, `thread show`, `thread list`,
  `thread exec`, `step show`, `step list`, `workflow show`, `workflow list`,
  `workflow validate`)
- The user has scripts written against 0.5.0 that look like one of:
  - `THREAD_ID=$(uwf thread start solve-issue -p '...' | jq -r .threadId)`
  - `uwf thread show $THREAD_ID --format json | jq .status`
  - `uwf workflow list --format json | jq -r '.[] | .name'`

## When
- The user upgrades `uwf` to the version that ships #308
- The user runs their existing scripts unchanged

## Then
- Scripts that read default-format stdout receive **text**, not JSON, and
  their JSON parsers fail. The fix is to add `--format raw-json` (or update
  the script to consume the envelope).
- Scripts using `--format json` receive an envelope; `jq .threadId` returns
  `null`. Either:
  - Update the path to `.value.threadId`, or
  - Replace `--format json` with `--format raw-json` for byte-for-byte
    compatibility with 0.5.0
- `--format raw-json` and `--format raw-yaml` produce output identical to
  0.5.0's `--format json` and `--format yaml` respectively, character-by-
  character (excluding any incidental whitespace differences explicitly
  noted in the test snapshot)
- A user running `uwf --help` sees the new `--format` description listing
  all five values with the default marked as `text`

## Documentation expectations

- `README.md` and `packages/cli/README.md` (if it exists) include a
  "0.5 → 0.6 migration" section pointing at `--format raw-json`
- The `Migration` snippet shows at least the three example scripts above
  with their corrected forms
- A changeset (`.changeset/<slug>.md`) describes the breaking change with
  bump types `@united-workforce/cli: minor` (and `@united-workforce/protocol`
  if the schemas live there). The changeset prose names the migration path
  to `raw-json`/`raw-yaml`.

## Edge Case: env var override is intentionally NOT introduced

### Given
- A user wishes to flip the default back to JSON globally (e.g.
  `UWF_DEFAULT_FORMAT=raw-json`)

### When
- They set such a variable and run the CLI

### Then
- The CLI ignores the variable — there is no environment-driven default for
  `--format` in this release. Users must pass `--format raw-json` per
  invocation or set a shell alias. Adding an env-var override is out of
  scope and should not be added without a follow-up issue.

## Edge Case: dashboards and other consumers

### Given
- The web dashboard package (`packages/dashboard/`) consumes uwf CLI output
  in any test fixture or runtime call

### When
- The CLI default flips to `text`

### Then
- All such call sites are updated to pass `--format json` (envelope) or
  `--format raw-json` (legacy bare) explicitly — no callsite within the
  monorepo relies on the unspecified default
- `pnpm run typecheck`, `pnpm run check`, and `pnpm run test` all pass
  after the migration — the test suite is the gating contract

## Negative Case: silent regression of legacy script

### Given
- A user did not read the CHANGELOG and runs `uwf thread show <id> | jq .status`

### When
- The CLI prints text instead of JSON

### Then
- `jq` exits non-zero with a "not valid JSON" message
- The user is expected to consult CHANGELOG / `--help` and add
  `--format raw-json`
- No silent fallback or auto-detect is introduced; the failure is loud and
  immediate, which is the intent of a breaking change
