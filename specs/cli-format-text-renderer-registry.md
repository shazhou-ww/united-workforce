---
scenario: "uwf CLI resolves text rendering through a per-command renderer registry with a JSON fallback"
feature: cli
tags: [cli, format, text, renderer, registry]
---

## Given
- `formatOutput(data, format)` lives in `packages/cli/src/format.ts`
- A command-keyed renderer registry of type `Record<string, (data: unknown) => string>` exists
- Each in-scope command registers a text renderer keyed by its command path (e.g. `"thread list"`, `"thread show"`, `"workflow list"`)

## When
- A command writes its result via `writeOutput(data)` and the active format is `"text"`

## Then
- `formatOutput` looks up the registered renderer for the active command
- The registered renderer is invoked with the command's result data
- The string returned by the renderer is written to stdout followed by a single trailing `\n`
- The renderer MUST return a `string` (never `undefined`)

## Alternative: No renderer registered → JSON fallback

### Given
- A command has no text renderer registered in the registry
- The active format is `"text"`

### When
- The command writes its result via `writeOutput(data)`

### Then
- `formatOutput` falls back to `JSON.stringify(data)` (pretty-printed for readability is acceptable but not required)
- Stdout MUST NOT contain the literal string `"undefined"`
- Exit code is 0 on success

## Alternative: Format `json` or `yaml` bypasses the registry

### Given
- A renderer IS registered for `"thread show"`
- The user passes `--format json` (or `--format yaml`)

### When
- The command writes its result

### Then
- The registered text renderer is NOT invoked
- Output is the JSON (or YAML) serialization of the result, identical to current behavior

## Edge Case: Renderer must not throw on partial data

### Given
- A command's result has an optional/missing nested field that the renderer reads

### When
- The renderer is invoked with `--format text`

### Then
- The renderer renders the available fields and substitutes a placeholder (e.g. `-` or empty string) for missing fields
- The renderer does NOT throw and exit code remains 0
