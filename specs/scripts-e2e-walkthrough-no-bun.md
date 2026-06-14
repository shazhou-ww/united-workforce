---
scenario: "E2E walkthrough script uses pnpm/node instead of bun"
feature: scripts
tags: [chore, bun-removal, scripts, e2e]
---

## Given

- `scripts/e2e-walkthrough.sh` exists with references to:
  - `$HOME/.bun/bin` in PATH
  - `bun install` commands
  - `UWF="bun $REPO_DIR/packages/cli/src/cli.ts"` execution
  - `bun run` invocations

## When

- Inspect the contents of `scripts/e2e-walkthrough.sh`

## Then

- No references to `.bun/bin` in PATH constructions
- All `bun install` replaced with `pnpm install`
- `UWF` variable uses `node` or the built CLI (`$REPO_DIR/packages/cli/dist/cli.js`)
- All `bun run` replaced with `pnpm run` or direct `node` invocations
- The script remains functionally equivalent (Docker-based E2E still works)
