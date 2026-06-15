---
scenario: "uwf workflow add renders human-readable text by default, matching the per-command renderer registry pattern from #329"
feature: workflow
tags: [cli, format, text, workflow, add]
---

## Given
- `packages/cli/src/cli.ts` defines the `workflow add` Commander subcommand
- The default value of the global `--format` flag is `"text"` (per #329)
- A valid workflow YAML file `./review-pr.yaml` exists with `name: review-pr`
- The CAS hash of the materialized workflow is `2TBP6T37TZAJZ` (13-char Crockford Base32)

## When
- User runs `uwf workflow add ./review-pr.yaml` (no `--format` flag → defaults to `text`)

## Then
- Stdout is human-readable text — NOT raw JSON
- Stdout MUST NOT begin with `{` (no JSON envelope, no raw JSON object)
- Stdout MUST NOT contain the literal string `"undefined"`
- Stdout includes both the registered workflow name and its CAS hash on separate, labeled lines, e.g.

  ```
  Registered  review-pr
  Hash        2TBP6T37TZAJZ
  ```

- Stdout ends with a single trailing `\n`
- Exit code is 0 on success

## Alternative: --format json bypasses the text renderer

### Given
- The same workflow YAML as above

### When
- User runs `uwf workflow add ./review-pr.yaml --format json`

### Then
- Stdout is a single-line JSON envelope of the form `{"type":<schemaHash>,"value":{"name":"review-pr","hash":"2TBP6T37TZAJZ"}}`
- The text renderer is NOT invoked
- Exit code is 0 on success

## Alternative: --format raw-json preserves legacy 0.5.0 byte-for-byte shape

### Given
- The same workflow YAML as above

### When
- User runs `uwf workflow add ./review-pr.yaml --format raw-json`

### Then
- Stdout is the bare JSON `{"name":"review-pr","hash":"2TBP6T37TZAJZ"}` followed by `\n`
- This matches the pre-#334 `workflow add` byte output (no envelope wrapping)
- Exit code is 0 on success

## Alternative: --format yaml emits a YAML envelope

### Given
- The same workflow YAML as above

### When
- User runs `uwf workflow add ./review-pr.yaml --format yaml`

### Then
- Stdout is a multi-line YAML envelope containing `type:` and `value:` keys
- `value` contains `name: review-pr` and `hash: 2TBP6T37TZAJZ`
- Exit code is 0 on success

## Edge Case: missing workflow file does not produce text output

### Given
- The path `./does-not-exist.yaml` does not exist

### When
- User runs `uwf workflow add ./does-not-exist.yaml`

### Then
- The command fails with a non-zero exit code
- Stderr contains an error message including `file not found`
- Stdout does NOT contain a partially-rendered text envelope

## Behavioral parity with #329 commands

### Given
- The text renderer registry from #329 covers `thread list`, `thread show`, `thread start`, `workflow list`, `workflow show`, `step list`, `step show`

### When
- A user runs any of the above commands OR `uwf workflow add` under default `--format text`

### Then
- Each command produces a human-readable rendering — NOT a raw JSON object
- `workflow add` is no longer the odd one out: its default output goes through the same renderer pipeline as the others
