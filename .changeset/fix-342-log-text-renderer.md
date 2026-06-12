---
"@united-workforce/cli": patch
---

fix(cli): route `log list` and `log show` output through text renderer (#342)

`uwf log list` and `uwf log show` were emitting raw JSON arrays instead of a
human-readable text view under the default `--format text`. This mirrors the
gap previously fixed for `thread cancel` (#331), `workflow add` (#334), and
`thread stop` (#341).

- Added `renderLogList` and `renderLogShow` to
  `packages/cli/src/text-renderers.ts`.
- Registered `"log list"` and `"log show"` in the `TEXT_RENDERERS` map in
  `format.ts`.
- Updated `cli.ts` to pass `"log list"` / `"log show"` as the `commandPath`
  to `writeRawOutput`, so `formatOutput` resolves the new renderers.

JSON / YAML output formats are unchanged.
