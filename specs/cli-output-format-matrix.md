---
scenario: "uwf CLI supports text/json/yaml/raw-json/raw-yaml output formats with text as the new default"
feature: cli
tags: [cli, format, output, envelope, breaking]
---

## Background

Issue #308 changes how every `uwf` command writes to stdout:

- **Default format becomes `text`** (previously `json`).
- The non-`text` formats now wrap the payload in an ocas-style envelope
  `{ type: <schemaHash>, value: <payload> }` so the output is self-describing
  and pipeable into `ocas render -p`.
- New `raw-json` / `raw-yaml` formats preserve the historical *bare-value*
  output for scripts that already parse `uwf` JSON.

The `--format` matrix and intended use:

| `--format` value | Output                                        | Use case                            |
| ---------------- | --------------------------------------------- | ----------------------------------- |
| `text` (default) | `ocas render`-style human-readable text       | Manual usage, terminal browsing     |
| `json`           | Envelope JSON `{ type, value }`               | Machine consumption, `ocas render`  |
| `yaml`           | Envelope YAML                                 | Machine consumption (YAML preferred)|
| `raw-json`       | Bare value JSON (no envelope)                 | Backward compatibility              |
| `raw-yaml`       | Bare value YAML (no envelope)                 | Backward compatibility              |

This is a **breaking change**: existing scripts that parse stdout JSON must
either move to `--format raw-json` or learn the envelope shape. The 0.x
breaking-change policy treats this as a minor bump.

## Given
- The CLI is built from the current source tree (`pnpm run build`)
- `~/.ocas/` has been seeded with at least one workflow named `solve-issue` and
  one idle thread `<thread-id>` started against it
- All output schemas listed in `cli-output-schemas.md` are already registered
  in CAS, with a `text` Liquid render template each
- `<thread-id>` resolves to a real thread ULID; `<schemaHash>` denotes the
  registered CAS hash of `@uwf/output/thread-status`

## When
- The user runs the CLI under each format flag (or omits it for the default):
  - `uwf thread show <thread-id>`
  - `uwf thread show <thread-id> --format text`
  - `uwf thread show <thread-id> --format json`
  - `uwf thread show <thread-id> --format yaml`
  - `uwf thread show <thread-id> --format raw-json`
  - `uwf thread show <thread-id> --format raw-yaml`
  - `uwf thread show <thread-id> --format json | ocas render -p`

## Then
- The default invocation (no `--format`) is identical to `--format text` — both
  exit 0 and emit the human-readable rendered template
  (e.g. lines starting with `Thread `, `Workflow `, `Status `, `Role `, `Head `).
- `--format text` resolves the registered `@ocas/template/text/<schemaHash>`
  Liquid template via `renderDirect(schemaHash, value, store, { resolution: 1 })`
  and writes the result to stdout followed by a single trailing newline.
- `--format json` writes a single line of JSON exactly equal to
  `JSON.stringify({ type: <schemaHash>, value: <payload> })` followed by a
  trailing newline. Parsing the output yields an object with two top-level
  keys `type` and `value`.
- `--format yaml` writes the same envelope as multi-line YAML (no document
  separator, no trailing blank line beyond a single newline). The first key
  parsed back is `type`, the second `value`.
- `--format raw-json` writes the bare payload (no envelope). For
  `thread show` this matches the historical 0.5.0 output exactly:
  `{"workflow":"...","thread":"...","status":"idle",...}`.
- `--format raw-yaml` writes the same bare payload as YAML.
- Piping `--format json` output into `ocas render -p` produces text byte-for-byte
  identical to `--format text` (modulo trailing newline differences).
- An unknown format value (e.g. `--format xml`) causes the CLI to exit non-zero
  with a stderr message naming the offending value and listing the supported
  formats.

## Edge Case: `text` is unavailable when no template is registered

### Given
- An output schema exists in CAS but its `@ocas/template/text/<hash>`
  variable has been deleted

### When
- User runs `uwf <command>` (defaults to `text`) for an output that uses that schema

### Then
- The CLI falls back to YAML rendering of the envelope (via
  `renderDirect(schemaHash, value, store, { resolution: 1 })`'s built-in
  YAML fallback) so users still see a usable representation
- The exit code is 0 — missing templates are not a hard error
- A one-line stderr warning is emitted naming the schema hash and the
  missing template variable

## Edge Case: stdout is not a TTY

### Given
- `uwf thread show <thread-id>` is invoked with stdout piped to another command
  (e.g. `uwf thread show <id> | cat`)

### When
- The user does not pass `--format`

### Then
- The default is **still `text`** — the format default does not change based
  on TTY detection. Scripts that need machine-parseable output must set
  `--format json` (envelope) or `--format raw-json` (bare) explicitly.

## Negative Case: format flag is rejected before invoking the command

### Given
- User passes a typo: `uwf thread show <id> --format jjson`

### When
- The CLI parses arguments

### Then
- Commander rejects the flag value (or the CLI's own validation does), exits
  non-zero, and writes a single error line to stderr
- No CAS reads occur and no payload is written to stdout
