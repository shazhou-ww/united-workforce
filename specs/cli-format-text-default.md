---
scenario: "uwf CLI defaults to human-readable text format and accepts --format text without producing 'undefined'"
feature: cli
tags: [cli, format, default, text]
---

## Given
- The user has installed `uwf` and any `uwf <command>` is available on PATH
- The CLI exposes a global `--format <fmt>` option

## When
- User runs any data-producing command **without** passing `--format` (e.g. `uwf thread list`)

## Then
- The command renders human-readable text by default (NOT a raw JSON envelope)
- Stdout MUST NOT begin with `{` or `[` for default invocations of `thread list`, `thread show`, `thread start`, `workflow list`, `workflow show`, `step list`, `step show`
- Stdout MUST NOT contain the literal string `"undefined"` as a top-level value
- The exit code is 0 on success
- `--help` for the global `--format` option lists `text`, `json`, `yaml` as accepted values and identifies `text` as the default

## Alternative: Explicit `--format text`

### Given
- The CLI is installed as above

### When
- User runs `uwf thread list --format text` (or any other in-scope command with `--format text`)

### Then
- Behavior is identical to the default invocation (human-readable text)
- Stdout MUST NOT contain the literal string `"undefined"`
- Exit code is 0 on success

## Alternative: Explicit `--format json` still produces JSON

### Given
- The CLI is installed as above

### When
- User runs `uwf thread show <thread-id> --format json`

### Then
- Stdout is parseable as JSON via `JSON.parse(stdout)` without throwing
- Exit code is 0 on success

## Alternative: Explicit `--format yaml` still produces YAML

### Given
- The CLI is installed as above

### When
- User runs `uwf thread show <thread-id> --format yaml`

### Then
- Stdout is parseable as YAML via the `yaml` package's `parse()` without throwing
- Exit code is 0 on success

## Type Contract

### Given
- The `OutputFormat` type is exported from `packages/cli/src/format.ts`

### When
- TypeScript compiles `packages/cli`

### Then
- `OutputFormat` includes `"text"` as a valid member alongside `"json"` and `"yaml"`
- `formatOutput(data, "text")` returns a `string` (not `undefined`)
- The Commander `--format` option declares its default value as `"text"` (not `"json"`)
