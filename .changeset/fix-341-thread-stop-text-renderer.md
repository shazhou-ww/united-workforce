---
"@united-workforce/cli": patch
---

fix(cli): route `thread stop` output through text renderer (#341)

`uwf thread stop` was emitting raw JSON (`{"thread":"...","stopped":false}`)
instead of a human-readable text view under the default `--format text`. This
mirrors the gap previously fixed for `thread cancel` (#331) and `workflow add`
(#334).

- Added `renderThreadStop` to `packages/cli/src/text-renderers.ts`.
- Registered `"thread stop"` in the `TEXT_RENDERERS` map in `format.ts`.
- Updated `cli.ts` to pass `"thread stop"` as the `commandPath` to
  `writeRawOutput`, so `formatOutput` resolves the new renderer.

JSON / YAML output formats are unchanged.
