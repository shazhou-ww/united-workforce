---
"@united-workforce/cli": patch
---

Fix `uwf workflow show` to resolve local project workflows from `.workflows/` directory using parent traversal, matching the behavior of `uwf thread start`. Previously, `workflow show` only resolved workflows from the global registry or direct CAS hashes, making it impossible to inspect local project workflows without first registering them globally via `uwf workflow add`.

The command now follows the full 4-strategy resolution order:
1. **CAS hash** — direct CAS load for 13-char Crockford Base32 hashes
2. **File path** — materialize from explicit `.yaml`/`.yml` paths (relative or absolute)
3. **Local discovery** — traverse upward from cwd to find `.workflows/<name>` (or legacy `.workflow/<name>`)
4. **Global registry** — fallback to `@uwf/registry/*` variables

This aligns `workflow show` with `thread start` and `workflow list`, ensuring consistent workflow resolution across all CLI commands.
