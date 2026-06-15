---
scenario: "util-agent splits — symbols still consumed by cli/broker stay; adapter-only helpers move to legacy"
feature: cleanup
tags: [phase4, cleanup, util-agent, legacy]
---

## Given
- Today `@united-workforce/util-agent` exports a mix of symbols. Some are still consumed by active workspace packages:
  - `cli/src/commands/broker-step.ts` imports `buildFrontmatterRetryPrompt`, `buildOutputFormatInstruction`, `mergeUsage`, `tryFrontmatterFastPath`, `trySuspendFastPath`.
  - `cli/src/commands/thread.ts` and `cli/src/__tests__/agent-resolution-llm-free.test.ts` import `getEnvPath`, `loadWorkflowConfig`.
  - `agent-builtin/src/{agent,prompt}.ts` and `agent-mock/src/mock-agent.ts` import `createAgent`, `buildRolePrompt`, `AgentContext`, `AgentRunResult`.
- Other exports are only used by the now-archived adapters (hermes / claude-code / sumeru):
  - `getCachedSessionId` / `setCachedSessionId` / `getAskSessionId` / `setAskSessionId` / `getCachePath` (per-agent SQLite session cache, replaced by broker's `session-store/`).
  - `buildContinuationPrompt`, `buildThreadProgress`, `buildContext`, `buildContextWithMeta`, `BuildContextMeta`, `buildSuspendOutput`, `parseArgv`, and the `AgentCleanupFn` / `AgentContinueFn` / `AgentForkFn` / `AgentRunFn` / `AgentOptions` / `AdapterOutput` types — all of which are external-CLI / fork lifecycle plumbing the broker no longer needs.

## When
- The maintainer trims `packages/util-agent/src/index.ts` to re-export ONLY the symbols still used by active workspace packages, and either deletes or moves the adapter-only helper files (`session-cache.ts`, `build-continuation-prompt.ts`, `build-thread-progress.ts`, `context.ts`, `run.ts`, parts of `frontmatter.ts` and `types.ts`) into `legacy-packages/util-agent-legacy/` to preserve the source for reference.
- The maintainer runs `pnpm run build && pnpm run typecheck && pnpm run test && pnpm run check` from the repo root.

## Then
- `cat packages/util-agent/src/index.ts` exports exactly the symbols still consumed by `cli/`, `broker/`, `agent-builtin/`, and `agent-mock/` — at minimum: `buildFrontmatterRetryPrompt`, `buildOutputFormatInstruction`, `mergeUsage`, `tryFrontmatterFastPath`, `trySuspendFastPath`, `getEnvPath`, `loadWorkflowConfig`, `getConfigPath`, `resolveStorageRoot`, `createAgent`, `buildRolePrompt`, `AgentContext`, `AgentRunResult` — and re-exports nothing else.
- `pnpm run build` succeeds for every package under `packages/*` with no `TS2305 Module has no exported member` errors.
- `pnpm run typecheck` (`tsc --build`) succeeds with no errors.
- `pnpm run test` succeeds with all package test suites green.
- `pnpm run check` (biome + lint-log-tags) succeeds with zero violations.
- Removed exports do NOT appear in `packages/util-agent/dist/index.d.ts` after rebuild — `grep -E '\\bgetCachedSessionId\\b|\\bbuildContinuationPrompt\\b|\\bparseArgv\\b' packages/util-agent/dist/index.d.ts` returns no match.
