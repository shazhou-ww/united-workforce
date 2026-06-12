---
scenario: "uwf thread stop renders human-readable text by default through the per-command renderer registry"
feature: cli
tags: [cli, format, text, renderer, thread, stop]
---

## Given
- The `TEXT_RENDERERS` registry in `packages/cli/src/format.ts` already maps `"thread list"`, `"thread show"`, `"thread start"`, `"thread cancel"`, `"workflow list"`, `"workflow show"`, `"step list"`, `"step show"`, `"config list"`, `"config get"`, and `"config set"` to renderers
- The `thread stop` command currently calls `writeRawOutput(result)` in `packages/cli/src/cli.ts` **without** passing a `commandPath` argument (line 402)
- `cmdThreadStop` returns a payload of type `StopOutput = { thread: ThreadId; stopped: boolean }`
- The CLI default `--format` is `"text"`
- Issue #331 fixed the analogous problem for `thread cancel` by adding `renderThreadCancel` and passing `"thread cancel"` as `commandPath`
- Issue #334 fixed the analogous problem for `workflow add`

## When
- User runs `uwf thread stop <thread-id>` against a running thread (no `--format` flag)

## Then
- Stdout MUST render a human-readable text view (NOT a raw JSON envelope)
- Stdout MUST NOT begin with `{` or `[`
- Stdout MUST NOT contain the literal string `"undefined"`
- The rendered output MUST include the target thread's ULID
- The rendered output MUST include an indication of whether the thread was stopped (e.g. a `Stopped  yes` line when `stopped === true`, or `Stopped  no` when `stopped === false`)
- Exit code is `0` on success
- A renderer keyed `"thread stop"` MUST be present in `TEXT_RENDERERS` and MUST be exported from `packages/cli/src/text-renderers.ts` (e.g. as `renderThreadStop`)
- The stop command's `.action()` in `packages/cli/src/cli.ts` MUST forward the command path `"thread stop"` to `writeRawOutput` so `formatOutput` resolves the registered renderer (i.e. `writeRawOutput(result, "thread stop")`)

## Alternative: Explicit `--format text`

### Given
- The CLI is installed as above

### When
- User runs `uwf thread stop <thread-id> --format text`

### Then
- Behavior is identical to the default invocation (human-readable text)
- Stdout MUST NOT contain the literal string `"undefined"`
- Exit code is `0`

## Alternative: Explicit `--format json` still produces JSON

### Given
- The CLI is installed as above

### When
- User runs `uwf thread stop <thread-id> --format json`

### Then
- Stdout is parseable as JSON via `JSON.parse(stdout)` without throwing
- The parsed object includes the keys `thread` and `stopped` from `StopOutput`
- The text renderer is NOT invoked
- Exit code is `0`

## Alternative: Explicit `--format yaml` still produces YAML

### Given
- The CLI is installed as above

### When
- User runs `uwf thread stop <thread-id> --format yaml`

### Then
- Stdout is parseable as YAML via the `yaml` package's `parse()` without throwing
- The parsed object includes the keys `thread` and `stopped` from `StopOutput`
- Exit code is `0`

## Behavior: stopped=true variant (thread was running)

### Given
- A thread with a valid marker file exists (i.e. a background `thread exec` process is alive)
- `cmdThreadStop` returns `{ thread: <id>, stopped: true }`

### When
- The renderer is invoked with the success payload, under default `--format text`

### Then
- The rendered output indicates the thread was stopped successfully (e.g. `Stopped     yes`)
- The rendered output includes the thread's ULID
- No `undefined` appears anywhere in stdout

## Behavior: stopped=false variant (no active marker)

### Given
- A thread exists in the active index but has no marker file (no background process running)
- `cmdThreadStop` writes a warning to stderr and returns `{ thread: <id>, stopped: false }`

### When
- The renderer is invoked with the `stopped: false` payload, under default `--format text`

### Then
- The rendered output indicates the thread was NOT stopped (e.g. `Stopped     no`)
- The rendered output still includes the thread's ULID
- The text renderer itself does not duplicate the stderr warning — it only formats the JSON payload
- No `undefined` appears anywhere in stdout
- Exit code is `0` (the warning is informational, not fatal)

## Edge Case: Renderer must not throw on partial data

### Given
- The renderer is invoked with a payload missing optional fields (e.g. `{ thread: "01J..." }` without `stopped`)

### When
- `TEXT_RENDERERS["thread stop"]` is called directly with that payload

### Then
- The renderer returns a `string` (never `undefined`)
- The renderer does NOT throw
- Missing fields render as a placeholder (e.g. `-`) consistent with the existing renderers in `text-renderers.ts` (matching the pattern used in `renderThreadCancel`)

## Edge Case: Thread not active

### Given
- No thread with the given ULID exists in the active index

### When
- User runs `uwf thread stop <missing-thread-id>`

### Then
- The CLI fails with a non-zero exit code and writes `thread not active: <thread-id>` to stderr
- This is the existing failure mode of `cmdThreadStop` and is NOT changed by the text renderer fix

## Type Contract

### Given
- `renderThreadStop` is exported from `packages/cli/src/text-renderers.ts`

### When
- TypeScript compiles `packages/cli`

### Then
- `renderThreadStop: (data: unknown) => string` (matches the `TextRenderer` type from `format.ts`)
- `TEXT_RENDERERS["thread stop"]` is defined and is the same function reference as `renderThreadStop`

## Behavioral parity with #331 / #334 / #329

### Given
- The text renderer registry covers `thread list`, `thread show`, `thread start`, `thread cancel`, `workflow list`, `workflow show`, `workflow add`, `step list`, `step show`

### When
- A user runs `uwf thread stop` under default `--format text`

### Then
- The command produces a human-readable rendering — NOT a raw JSON object
- `thread stop` is no longer the odd one out: its default output goes through the same renderer pipeline as the others
- The output style (labelled rows: label, whitespace, value) matches `renderThreadCancel`
