---
"@united-workforce/cli": patch
---

Fix `formatOutput(data, "text")` returning `undefined` (issue #327).

`OutputFormat` already included `"text"` per #320, but the legacy
`formatOutput` helper still only exhaustively matched `"json" | "yaml"` —
calling it with `"text"` fell through the switch and returned `undefined`.
That bug was masked in production because the CLI's `writeRawOutput`
narrowed the format down to `"json" | "yaml"` before calling
`formatOutput`. Tests and library consumers that called `formatOutput`
directly with `"text"` got the literal string `"undefined"` printed.

Changes:

- `formatOutput(data, format, commandPath?)` now accepts the full
  `OutputFormat` union (`text | json | yaml | raw-json | raw-yaml`) and
  always returns a `string`.
- New `TEXT_RENDERERS` registry of type
  `Record<string, (data: unknown) => string>` provides per-command text
  renderers for `thread list`, `thread show`, `thread start`,
  `workflow list`, `workflow show`, `step list`, and `step show`. The
  rendererss tolerate missing/null fields and never return `undefined`.
- `getTextRenderer(commandPath)` and `registerTextRenderer(commandPath, fn)`
  expose the registry for library consumers.
- When `formatOutput` is called with `"text"` and no `commandPath` (or no
  matching renderer), it falls back to a pretty-printed JSON serialization
  rather than `undefined`.
- `writeRawOutput` in the CLI was simplified to forward the active format
  directly to `formatOutput`, so `--format text` is consistently honored
  for the legacy raw-output commands (`thread cancel`, `step fork`,
  `setup`, `log`, `config`).
