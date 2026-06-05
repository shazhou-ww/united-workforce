---
"@united-workforce/cli": patch
---

fix: improve bootstrap docs — agent discovery, pnpm/npm parity, preset provider table (#118, #120)

- Step 1: detect installed agents (hermes/claude) before choosing adapter
- Step 1: clarify adapter versions are independent from CLI — install @latest
- Step 1: show pnpm and npm side-by-side
- Step 1: add "adapter must be installed before `uwf setup --agent`" note
- Step 1: add ACP verification step (hermes acp --help)
- Step 2: `--agent` takes adapter command name (e.g. `uwf-hermes`), not npm package
- Step 2: preset providers listed as a table with names and default base URLs
- Remove uwf-builtin from supported adapters (not ready yet)
