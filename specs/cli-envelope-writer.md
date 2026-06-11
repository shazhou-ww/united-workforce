---
scenario: "CLI commands construct ocas envelopes and route through the unified output writer"
feature: cli
tags: [cli, format, envelope, breaking, refactor]
---

## Background

Phase 3 of issue #308 reshapes how every uwf CLI command writes its result.
Each command must build a `{ type: <schemaHash>, value: <payload> }`
envelope, then hand it to a single output writer that picks a format-specific
emitter:

- `text` → `renderDirect(typeHash, value, store, { resolution: 1 })` →
  trimmed string + trailing newline
- `json` → `JSON.stringify({ type, value })` + trailing newline
- `yaml` → YAML stringify of `{ type, value }` (trim, then trailing newline)
- `raw-json` → `JSON.stringify(value)` + trailing newline (legacy bare value)
- `raw-yaml` → YAML stringify of `value` (legacy bare value)

This concentrates the CAS-store dependency, the schema-hash lookup, and the
envelope construction in **one** code path. Individual command modules
(`commands/thread.ts`, `commands/workflow.ts`, `commands/step.ts`, etc.)
return *plain payload data*; they never call `JSON.stringify`,
`yaml.stringify`, or `process.stdout.write` themselves.

## Given
- `packages/cli/src/format.ts` (or its replacement `output.ts`) exports a
  function `writeEnvelope(payload, schemaName, options)` (or equivalent) that:
  - Looks up the schema hash from `@uwf/output/<schemaName>` once per process
    (cached) using the resolved `~/.ocas/` store
  - Switches on `options.format` to choose between the five emitters listed
    above
  - Returns `void` and writes to `process.stdout`
- `packages/cli/src/cli.ts`'s `writeOutput()` helper is rewritten to take a
  schema name in addition to the payload, and delegates to `writeEnvelope`
- The `--format` option on the root `Command` accepts the literal values
  `text`, `json`, `yaml`, `raw-json`, `raw-yaml` and defaults to `text`
- All command modules (`commands/thread.ts`, `commands/workflow.ts`,
  `commands/step.ts`, `commands/log.ts`, `commands/setup.ts`, etc.) return
  payload-only objects matching their declared output schema

## When
- The CLI parses arguments and invokes a command
- The command function returns a payload, and `cli.ts` forwards it to
  `writeEnvelope` along with the schema name (e.g. `"thread-status"`)

## Then
- The format flag is read **once** in `cli.ts` and forwarded to
  `writeEnvelope`; no command function inspects the format itself
- The schema-hash lookup is cached per process; resolving a schema name
  twice in the same process returns the same hash without re-reading the
  store
- The output writer never throws when the payload is well-formed; it returns
  cleanly after a single `process.stdout.write` call
- For `text` and missing template, the writer falls back to `renderDirect`'s
  built-in YAML rendering and emits a single stderr warning (per
  `cli-output-render-templates.md`)
- Exit code is 0 for every supported `--format` value when the underlying
  command succeeds
- A snapshot of `--format json` output for `thread show` parses as:
  ```ts
  const out = JSON.parse(stdout);
  out.type === schemaHashOf("thread-status");
  out.value.threadId === "<ULID>";
  out.value.workflowHash === "<13-char hash>";
  ```

## Edge Case: commands that previously printed `null` payload

### Given
- A command currently returns `null` to the writer (e.g. on a no-op success)

### When
- The writer is invoked with `null` and a schema name

### Then
- The envelope still has the form `{ type: <hash>, value: null }`; the schema
  registration explicitly allows `null` only when the schema documents it.
  Otherwise the writer treats `null` as a programmer error and throws — this
  is enforced before the breaking-change rollout

## Edge Case: command emits multiple envelopes (`thread exec --count N`)

### Given
- `uwf thread exec <id> --count 3` runs three iterations
- The user's chosen format is `json` (envelope) or `text`

### When
- All three iterations complete successfully

### Then
- The CLI emits a **single** envelope of type `@uwf/output/thread-exec`
  whose `value.steps[]` has three entries — not three separate envelopes.
  This avoids ambiguity about whether stdout is a stream of envelopes or a
  single envelope
- For `--format text` the rendered template contains three `Step N` lines
  per `cli-output-render-templates.md`

## Negative Case: schema lookup fails

### Given
- The startup registration helper has been disabled or the store path was
  pointed at an empty directory, so `@uwf/output/thread-status` is unset

### When
- `uwf thread show <id>` runs

### Then
- The CLI exits non-zero with a stderr message naming the missing schema
  variable and a hint to run setup
- No partial output is written to stdout
- The exit code is distinct from a successful command (≥ 1)

## Refactor expectation: file/module shape

- `format.ts`'s old `formatOutput(data, format)` (with format type
  `"json" | "yaml"`) is removed or marked internal — the new public
  surface is `writeEnvelope(...)` plus the `OutputFormat` union
  `"text" | "json" | "yaml" | "raw-json" | "raw-yaml"`
- Existing tests in `packages/cli/src/__tests__/step-show-json.test.ts`
  that import `formatOutput` are updated to the new API or replaced with
  envelope-aware equivalents
- The module remains under `packages/cli/src/` and is still imported via
  the package's local entry (no new public export from
  `@united-workforce/cli`)

## Type expectation: OutputFormat union

```ts
export type OutputFormat =
  | "text"
  | "json"
  | "yaml"
  | "raw-json"
  | "raw-yaml";
```

- The default Commander value is `"text"`
- The CLI's argument-validation rejects any other string with a stderr
  message that lists the five allowed values
