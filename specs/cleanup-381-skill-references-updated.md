---
scenario: "uwf-usage and uwf-adapter-developing skills no longer recommend installing legacy adapter binaries"
feature: cleanup
tags: [phase4, cleanup, skills, prompt]
---

## Given
- The skill source files live in `packages/util/src/`:
  - `usage-reference.ts` is the source of `uwf prompt usage` (skill `uwf-usage`).
  - `adapter-developing-reference.ts` is the source of `uwf prompt adapter-developing` (skill `uwf-adapter-developing`).
- These files currently recommend installing `@united-workforce/agent-hermes` / `@united-workforce/agent-claude-code` and import from `@united-workforce/util-agent` symbols (`getCachedSessionId`, `setCachedSessionId`, `parseArgv`, etc.) that are being removed in this issue.
- Other CLI source files also reference the legacy adapter binaries:
  - `packages/cli/src/commands/prompt.ts` lines 99–123, 139, 268–271 (install / verify instructions).
  - `packages/cli/src/commands/setup.ts` lines 109, 139–140, 175–176 (binary scan + install hints).

## When
- The maintainer rewrites `usage-reference.ts` and `adapter-developing-reference.ts` so the rendered skills describe the broker-based architecture instead of the per-agent CLI binary, then runs `pnpm run build && pnpm run test` for the `@united-workforce/util` package.

## Then
- `grep -E '@united-workforce/agent-hermes|@united-workforce/agent-claude-code|@united-workforce/agent-sumeru' packages/util/src/usage-reference.ts packages/util/src/adapter-developing-reference.ts` returns no match.
- `grep -E 'getCachedSessionId|setCachedSessionId|getAskSessionId|setAskSessionId|parseArgv|buildContinuationPrompt' packages/util/src/adapter-developing-reference.ts` returns no match — the example code does not import symbols that no longer exist.
- Running `node packages/cli/dist/cli.js prompt usage` writes a SKILL.md whose body describes `uwf` workflow authoring with broker (no `pnpm add -g @united-workforce/agent-hermes` line).
- Running `node packages/cli/dist/cli.js prompt adapter-developing` writes a SKILL.md whose body explains writing a Sumeru gateway / broker-side agent integration (NOT a `uwf-<name>` CLI binary recipe).
- `pnpm run test --filter @united-workforce/util` passes — existing test `packages/cli/src/__tests__/prompt.test.ts` is updated to assert on the new content (no expectation on `createAgent` import string for adapter-developing if that helper is removed from public API).
