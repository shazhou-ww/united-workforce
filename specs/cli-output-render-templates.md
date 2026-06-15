---
scenario: "Each CLI output schema has a Liquid render template registered under @ocas/template/text/<schemaHash>"
feature: cli
tags: [cli, render, template, liquid, ocas]
---

## Background

The default `--format text` path for every uwf CLI command goes through
`renderDirect(typeHash, value, store, { resolution: 1 })` (or `renderAsync`
for stored nodes). At resolution=1 the renderer expands the value's own
fields but does **not** recurse into CAS references — nested hashes
(workflow, head, output ref, etc.) appear as their bare 13-char strings.

Display granularity is therefore controlled entirely by the per-schema
Liquid template stored under the variable
`@ocas/template/text/<schemaHash>`. Issue #308 ships one template per
output schema, with the exact textual layouts shown below.

## Given
- All nine output schemas from `cli-output-schemas.md` are registered
  in CAS
- For each schema hash `<H>`, a Liquid template string is registered under
  the variable `@ocas/template/text/<H>` via the same registration helper
  that registers the schemas
- `renderDirect` is invoked with `resolution: 1` (the only resolution the
  CLI uses for `text`)

## When
- The CLI emits each command's output under the default format

## Then — exact rendered text per command

### `uwf thread show <thread-id>` (`@uwf/output/thread-status`)
```
Thread  06FBA1Q7M1CKY5RF2V1VKBX0WR
Workflow D7SX84RSZG22V
Status  idle
Role    developer
Head    49RG4YFX95AYA
```
- Each line is exactly two columns separated by run-of-spaces; column widths
  are stable (label column padded so values align under each other)
- When `head` is `null`, the `Head` line shows `-` instead of a hash
- When `status` is `suspended`, an extra `Suspend  <suspendMessage>` line is
  appended; `suspendedRole` is shown on the `Role` line if non-null
- The output has a trailing newline; no leading blank line

### `uwf thread list` (`@uwf/output/thread-list`)
```
THREAD                      WORKFLOW       STATUS  ROLE       STARTED
06FBA1Q7M1CKY5RF2V1VKBX0WR  D7SX84RSZG22V  idle    developer  2026-06-11 03:44
06FBA1QQ22H04NSF5K8MG5T9R4  76C98RVXA5E4F  end     -          2026-06-11 03:44
```
- A header row using the column names above, in upper case
- Each item renders as a single line; column widths are computed from the
  max width across rows (header included)
- `currentRole` of `null` renders as `-`
- `startedAt` is rendered in local-timezone `YYYY-MM-DD HH:MM` form
- Empty list renders the header row only (no extra blank line)

### `uwf thread exec <thread-id>` (`@uwf/output/thread-exec`)
```
Step 1  planner   → idle
Step 2  developer → idle
Step 3  reviewer  → idle
Step 4  committer → end ✓
```
- One line per executed step, numbered from 1
- The arrow is the literal `→` (U+2192)
- A `✓` suffix is added when `done` is true on the final step

### `uwf thread start ...` (`@uwf/output/thread-start`)
```
Thread  06FBA1Q7M1CKY5RF2V1VKBX0WR
Workflow D7SX84RSZG22V
```

### `uwf step show <hash>` (`@uwf/output/step-detail`)
```
Step    49RG4YFX95AYA
Role    developer
Agent   uwf-claude-code
Status  completed
Duration 45.2s
```
- `Duration` formats `durationMs` as seconds with one decimal place when
  ≥ 1000 ms, otherwise as `<ms>ms`
- `Status` mirrors the agent's `$status` frontmatter value verbatim

### `uwf step list <thread-id>` (`@uwf/output/step-list`)
```
HASH           ROLE        DURATION
49RG4YFX95AYA  planner     12.3s
8ABC4XYZ12345  developer   45.2s
```

### `uwf workflow show <id>` (`@uwf/output/workflow-detail`)
```
Workflow  solve-issue
Version   1
Hash      76C98RVXA5E4F
Roles     planner, developer, reviewer, tester, committer
Graph     $START → planner → developer → reviewer → ...
```
- `Roles` lists role names comma-separated in declaration order
- `Graph` renders the linear happy-path traversal starting from `$START`,
  truncated with `…` when more than 5 nodes are present

### `uwf workflow list` (`@uwf/output/workflow-list`)
```
NAME          HASH           SOURCE     DESCRIPTION
solve-issue   76C98RVXA5E4F  .workflows solve issues via plan+code+review
review-pr     531QCTXSW1T51  .workflows review and merge PRs
release       D7SX84RSZG22V  registry   release workflow
```
- `source` is one of `.workflows` (local discovery) or `registry`
  (global registry); arbitrary strings are passed through unchanged

### `uwf workflow validate <file>` (`@uwf/output/validate-result`)
- Valid case:
  ```
  ✓ valid
  ```
- Invalid case:
  ```
  ✗ invalid (3 errors)
    - template variable "unknown" not found in role "proponent"
    - <next error>
    - <next error>
  ```
- Error count in parentheses matches `errors.length`
- Each error is indented with two spaces and prefixed by `- `

## Edge Case: missing template falls back to YAML

### Given
- A schema `<H>` is registered but `@ocas/template/text/<H>` does not exist
  (variable absent or pointing to a missing CAS hash)

### When
- A command runs under the default `text` format

### Then
- `renderDirect` returns YAML output of the envelope payload
- The CLI prints that YAML to stdout, exits 0, and prints a single stderr
  warning naming the schema hash and the missing template

## Edge Case: ocas render -p produces the same text

### Given
- The CLI emits envelope JSON via `--format json`
- `ocas render -p` is on PATH and shares the same `~/.ocas/` store

### When
- `uwf <command> --format json | ocas render -p` runs

### Then
- The piped output equals the `--format text` output (modulo a single
  trailing newline difference) for every command/schema combination — both
  paths use `renderDirect(<H>, <value>, store, { resolution: 1 })` and
  resolve the same template
