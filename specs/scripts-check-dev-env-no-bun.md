---
scenario: "Dev environment check script validates pnpm/node instead of bun"
feature: scripts
tags: [chore, bun-removal, scripts]
---

## Given

- `scripts/check-dev-env.sh` checks for bun version, uses `bun install`, `bun run build`, and `bun link`

## When

- Inspect the contents of `scripts/check-dev-env.sh`

## Then

- The bun version check is removed (bun is no longer a prerequisite)
- `bun install` references replaced with `pnpm install`
- `bun run build` replaced with `pnpm run build`
- `bun link` references replaced with `pnpm link` or equivalent
- uwf-hermes/uwf-claude-code wrapper instructions no longer reference bun
- The script checks for `pnpm` as a prerequisite instead of `bun`
