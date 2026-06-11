---
scenario: "uwf thread cancel renders human-readable text by default through the per-command renderer registry"
feature: cli
tags: [cli, format, text, renderer, thread, cancel]
---

## Given
- The `TEXT_RENDERERS` registry in `packages/cli/src/format.ts` already maps `"thread list"`, `"thread show"`, `"thread start"`, `"workflow list"`, `"workflow show"`, `"step list"`, and `"step show"` to renderers in `packages/cli/src/text-renderers.ts`
- The `thread cancel` command currently calls `writeRawOutput(result)` in `packages/cli/src/cli.ts` **without** passing a `commandPath` argument
- `cmdThreadCancel` returns a payload of type `CancelOutput = { thread: ThreadId; cancelled: boolean }`
- The CLI default `--format` is `"text"`

## When
- User runs `uwf thread cancel <thread-id>` against an active thread (no `--format` flag)

## Then
- Stdout MUST render a human-readable text view (NOT a raw JSON envelope)
- Stdout MUST NOT begin with `{` or `[`
- Stdout MUST NOT contain the literal string `"undefined"`
- The rendered output MUST include the cancelled thread's ULID
- The rendered output MUST include a confirmation that the thread was cancelled (e.g. a `Status` line containing `cancelled`, or an explicit `Cancelled  yes` line)
- Exit code is `0` on success
- A renderer keyed `"thread cancel"` MUST be present in `TEXT_RENDERERS` and MUST be exported from `packages/cli/src/text-renderers.ts` (e.g. as `renderThreadCancel`)
- The cancel command's `.action()` in `packages/cli/src/cli.ts` MUST forward the command path `"thread cancel"` to `writeRawOutput` so `formatOutput` resolves the registered renderer

## Alternative: Explicit `--format text`

### Given
- The CLI is installed as above

### When
- User runs `uwf thread cancel <thread-id> --format text`

### Then
- Behavior is identical to the default invocation (human-readable text)
- Stdout MUST NOT contain the literal string `"undefined"`
- Exit code is `0`

## Alternative: Explicit `--format json` still produces JSON

### Given
- The CLI is installed as above

### When
- User runs `uwf thread cancel <thread-id> --format json`

### Then
- Stdout is parseable as JSON via `JSON.parse(stdout)` without throwing
- The parsed object includes the keys `thread` and `cancelled` from `CancelOutput`
- Exit code is `0`

## Alternative: Explicit `--format yaml` still produces YAML

### Given
- The CLI is installed as above

### When
- User runs `uwf thread cancel <thread-id> --format yaml`

### Then
- Stdout is parseable as YAML via the `yaml` package's `parse()` without throwing
- The parsed object includes the keys `thread` and `cancelled` from `CancelOutput`
- Exit code is `0`

## Edge Case: Renderer must not throw on partial data

### Given
- The renderer is invoked with a payload missing optional fields (e.g. `{ thread: "01J..." }` without `cancelled`)

### When
- `TEXT_RENDERERS["thread cancel"]` is called directly with that payload

### Then
- The renderer returns a `string` (never `undefined`)
- The renderer does NOT throw
- Missing fields render as a placeholder (e.g. `-`) consistent with the existing renderers in `text-renderers.ts`

## Edge Case: Thread not active

### Given
- No thread with the given ULID exists in the active index

### When
- User runs `uwf thread cancel <missing-thread-id>`

### Then
- The CLI fails with a non-zero exit code and writes `thread not active: <thread-id>` to stderr
- This is the existing failure mode of `cmdThreadCancel` and is NOT changed by the text renderer fix

## Type Contract

### Given
- `renderThreadCancel` is exported from `packages/cli/src/text-renderers.ts`

### When
- TypeScript compiles `packages/cli`

### Then
- `renderThreadCancel: (data: unknown) => string` (matches the `TextRenderer` type from `format.ts`)
- `TEXT_RENDERERS["thread cancel"]` is defined and is the same function reference as `renderThreadCancel`
