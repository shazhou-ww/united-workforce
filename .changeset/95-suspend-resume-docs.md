---
"@united-workforce/cli": patch
---

docs: document timeout-as-suspend in the Suspend / Resume section (RFC #95 Phase 3)

The CLI README's Suspend / Resume section only covered *voluntary* suspend (an
agent emitting `$status: "$SUSPEND"`). Phase 2 (#435) added a second source —
**timeout-as-suspend**: when a `send` exceeds the adapter timeout the broker now
yields a `kind: "suspended"` result that lands at the same `$SUSPEND` exit, so a
timeout becomes a recoverable checkpoint instead of a fatal error.

- Document both suspend sources (voluntary + timeout checkpoint) and how `resume`
  issues a fresh `send` that reuses the cached session / native `--resume <id>`.
- Add the previously-missing `resume` and `poke` thread commands to the top-level
  README command table.

Docs only — no behavior change.
