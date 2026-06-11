---
"@united-workforce/cli": patch
---

fix(cli): render `thread cancel` output via the per-command text renderer

`uwf thread cancel <thread-id>` previously produced raw JSON under the
default `--format text` because the cancel `.action()` did not pass a
`commandPath` to `writeRawOutput`, and `TEXT_RENDERERS` had no entry
for `"thread cancel"`. This adds `renderThreadCancel` and registers it,
matching the pattern introduced in #329 for the other CLI commands.
JSON / YAML output is unchanged.

Fixes #331
