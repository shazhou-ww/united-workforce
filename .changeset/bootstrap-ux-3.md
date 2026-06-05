---
"@united-workforce/cli": patch
---

fix: improve bootstrap docs — pnpm/npm parity, adapter install order, preset provider table (#118)

- Step 1: show pnpm and npm side-by-side (not just pnpm with a comment)
- Step 1: add "adapter must be installed before `uwf setup --agent`" note
- Step 1: add `uwf --version` and adapter version verification with PATH troubleshooting
- Step 2: `--agent` takes adapter command name (e.g. `uwf-hermes`), not npm package
- Step 2: preset providers listed as a table with names and default base URLs
- Step 2: non-preset providers must specify `--base-url` manually
- Upgrade scenario: also show npm alternatives
