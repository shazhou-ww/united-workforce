---
scenario: "uwf setup and uwf prompt no longer scan for or recommend legacy adapter binaries"
feature: cleanup
tags: [phase4, cleanup, cli, setup, prompt]
---

## Given
- `packages/cli/src/commands/setup.ts` currently:
  - Calls `which -a uwf-hermes uwf-claude-code uwf-cursor` to discover installed adapters (line ~109).
  - Maps `"uwf-hermes" → "Hermes (hermes-agent)"` and `"uwf-claude-code" → "Claude Code"` in the friendly-name table (lines ~139–140).
  - Prints `npm i -g @united-workforce/agent-hermes` / `agent-claude-code` install hints when no adapter is found (lines ~175–176).
  - Verifies `hermes` CLI presence on PATH because `uwf-hermes` depends on it (lines ~260–266).
- `packages/cli/src/commands/prompt.ts` similarly hands out install instructions for `@united-workforce/agent-hermes` and `@united-workforce/agent-claude-code` and explains Hermes ACP plugin setup.
- Tests in `packages/cli/src/__tests__/setup-complexity.test.ts` and `packages/cli/src/__tests__/config-text-renderer.test.ts` assert that strings like `"uwf-hermes"` and `"uwf-claude-code"` appear in setup output.

## When
- The maintainer rewrites the setup flow so that:
  1. `which -a` (or equivalent) only scans for active in-process bins (e.g. `uwf-builtin`) AND reports broker connectivity instead of binary discovery for hosted agents.
  2. Install hints reference broker / Sumeru host configuration, not adapter binary packages.
  3. Hermes-specific PATH / plugin verification is removed (or moved to a Sumeru-side check).
- Tests are updated to assert the new strings, with no remaining expectations on legacy `uwf-hermes` / `uwf-claude-code` substrings.

## Then
- `grep -nE 'uwf-hermes|uwf-claude-code|uwf-sumeru|@united-workforce/agent-hermes|@united-workforce/agent-claude-code|@united-workforce/agent-sumeru' packages/cli/src/commands/setup.ts packages/cli/src/commands/prompt.ts` returns no match.
- Running `pnpm --filter @united-workforce/cli test` passes, including the rewritten `setup-complexity.test.ts` and `config-text-renderer.test.ts` (no asserts on removed binary names).
- `node packages/cli/dist/cli.js setup --help` succeeds and the rendered help text contains no `uwf-hermes` / `uwf-claude-code` / `agent-hermes` / `agent-claude-code` substrings.
- On a machine with NO legacy adapters installed, `node packages/cli/dist/cli.js setup --agent claude-code` does NOT print install instructions for `@united-workforce/agent-claude-code`; it instead prints broker / Sumeru host configuration guidance.
