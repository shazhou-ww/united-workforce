---
scenario: "uwf log list and log show render human-readable text by default through the per-command renderer registry"
feature: cli
tags: [cli, format, text, renderer, log]
---

## Given
- The `TEXT_RENDERERS` registry in `packages/cli/src/format.ts` maps `"thread list"`, `"thread show"`, `"thread start"`, `"thread cancel"`, `"workflow list"`, `"workflow show"`, `"step list"`, `"step show"`, `"config list"`, `"config get"`, and `"config set"` to renderers in `packages/cli/src/text-renderers.ts`
- The `log list` command currently calls `writeRawOutput(result)` in `packages/cli/src/cli.ts` **without** passing a `commandPath` argument
- The `log show` command currently calls `writeRawOutput(result)` in `packages/cli/src/cli.ts` **without** passing a `commandPath` argument
- `cmdLogList` returns a payload of type `Array<{ name: string; size: number; date: string }>`
- `cmdLogShow` returns a payload of type `Array<{ ts: string; pid: string; tag: string; msg: string; thread: string | null; workflow: string | null }>`
- The CLI default `--format` is `"text"`

## When
- User runs `uwf log list` (no arguments, no `--format` flag)

## Then
- Stdout MUST render a human-readable text view (NOT a raw JSON array)
- Stdout MUST NOT begin with `{` or `[`
- Stdout MUST NOT contain the literal string `"undefined"`
- The rendered output MUST include a header line and one row per log file
- Each row MUST include: log file name, date, and size (size MAY be formatted as bytes, KB, MB, etc.)
- Exit code is `0` on success
- A renderer keyed `"log list"` MUST be present in `TEXT_RENDERERS` and MUST be exported from `packages/cli/src/text-renderers.ts` (e.g. as `renderLogList`)
- The log list command's `.action()` in `packages/cli/src/cli.ts` MUST forward the command path `"log list"` to `writeRawOutput` so `formatOutput` resolves the registered renderer

## Behavior: log show

### Given
- The CLI is installed as above
- At least one log file exists with at least one entry

### When
- User runs `uwf log show` (no arguments)

### Then
- Stdout MUST render a human-readable text view (NOT a raw JSON array)
- Stdout MUST NOT begin with `{` or `[`
- Stdout MUST NOT contain the literal string `"undefined"`
- The rendered output MUST include one human-readable line per log entry
- Each line MUST include: timestamp (`ts`), process id (`pid`), tag, and message (`msg`)
- Entries with a non-null `thread` field SHOULD include the thread id in the line
- Exit code is `0` on success
- A renderer keyed `"log show"` MUST be present in `TEXT_RENDERERS` and MUST be exported from `packages/cli/src/text-renderers.ts` (e.g. as `renderLogShow`)
- The log show command's `.action()` in `packages/cli/src/cli.ts` MUST forward the command path `"log show"` to `writeRawOutput`

## Alternative: log list with no log files

### Given
- The logs directory is empty or does not exist
- `cmdLogList` returns `[]`

### When
- User runs `uwf log list`

### Then
- Stdout MUST NOT contain the literal string `"undefined"`
- Stdout MUST render a header-only table OR a friendly empty-state message (e.g. `No log files.`)
- Exit code is `0`

## Alternative: log show with no entries

### Given
- The logs directory has no matching entries for the given filter (or no log files at all)
- `cmdLogShow` returns `[]`

### When
- User runs `uwf log show`

### Then
- Stdout MUST NOT contain the literal string `"undefined"`
- Stdout MUST render an empty-state message (e.g. `No log entries.`) or be empty (zero bytes followed by a newline)
- Exit code is `0`

## Alternative: Explicit `--format text`

### Given
- The CLI is installed as above

### When
- User runs `uwf log list --format text` or `uwf log show --format text`

### Then
- Behavior is identical to the default invocation (human-readable text)
- Stdout MUST NOT contain the literal string `"undefined"`
- Exit code is `0`

## Alternative: Explicit `--format json` still produces JSON

### Given
- The CLI is installed as above

### When
- User runs `uwf log list --format json` or `uwf log show --format json`

### Then
- Stdout is parseable as JSON via `JSON.parse(stdout)` without throwing
- For `log list`, the parsed value is an array; each element has `name`, `size`, and `date` keys
- For `log show`, the parsed value is an array; each element has `ts`, `pid`, `tag`, and `msg` keys
- The registered text renderer is NOT invoked
- Exit code is `0`

## Alternative: Explicit `--format yaml` still produces YAML

### Given
- The CLI is installed as above

### When
- User runs `uwf log list --format yaml` or `uwf log show --format yaml`

### Then
- Stdout is parseable as YAML via the `yaml` package's `parse()` without throwing
- The registered text renderer is NOT invoked
- Exit code is `0`

## Alternative: log show with filters

### Given
- The CLI is installed as above
- Multiple log files exist with entries from different threads, processes, and dates

### When
- User runs `uwf log show --thread <thread-id>`, `uwf log show --process <pid>`, or `uwf log show --date <YYYY-MM-DD>`

### Then
- Stdout MUST render a human-readable text view of only the filtered entries
- Stdout MUST NOT begin with `{` or `[`
- Stdout MUST NOT contain the literal string `"undefined"`
- Exit code is `0`

## Edge Case: Renderer must not throw on partial data

### Given
- The renderer is invoked with a payload missing optional fields (e.g. a log entry with `thread: null` or a log list item with `size: 0`)

### When
- `TEXT_RENDERERS["log list"]` or `TEXT_RENDERERS["log show"]` is called directly with the payload

### Then
- The renderer returns a `string` (never `undefined`)
- The renderer does NOT throw
- Missing or null fields render as a placeholder (e.g. `-`) consistent with the existing renderers in `text-renderers.ts`

## Edge Case: Renderer must not throw on non-array input

### Given
- The renderer is invoked with a non-array payload (e.g. `null`, `undefined`, or an object)

### When
- `TEXT_RENDERERS["log list"]` or `TEXT_RENDERERS["log show"]` is called

### Then
- The renderer returns a `string` (never `undefined`)
- The renderer does NOT throw
- The result is either an empty-state message or just a header line

## Type Contract

### Given
- `renderLogList` and `renderLogShow` are exported from `packages/cli/src/text-renderers.ts`

### When
- TypeScript compiles `packages/cli`

### Then
- `renderLogList: (data: unknown) => string` (matches the `TextRenderer` type from `format.ts`)
- `renderLogShow: (data: unknown) => string` (matches the `TextRenderer` type from `format.ts`)
- `TEXT_RENDERERS["log list"]` is defined and is the same function reference as `renderLogList`
- `TEXT_RENDERERS["log show"]` is defined and is the same function reference as `renderLogShow`

## Note: log clean is out of scope

### Given
- `cmdLogClean` returns `{ deleted: number }` and is unaffected by this change

### Then
- `log clean` MAY remain on the raw fallback path (existing behavior preserved) OR receive its own renderer in a follow-up — this spec does NOT require a `"log clean"` renderer
