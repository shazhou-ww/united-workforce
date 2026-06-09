---
"@united-workforce/util": patch
"@united-workforce/cli": patch
---

docs: rewrite `adapter-developing` prompt for v0.4 contract (#214)

`generateAdapterDevelopingReference()` was multiple versions behind. Rewrite covers:

- `AgentOptions.fork: AgentForkFn | null` and `AgentOptions.cleanup: AgentCleanupFn | null`
- complete public helpers table including `buildSuspendOutput`, `buildFrontmatterRetryPrompt`, `buildThreadProgress`, `getCachedSessionId`/`setCachedSessionId`, `getAskSessionId`/`setAskSessionId`
- `$SUSPEND` coroutine yield (`buildSuspendOutput`, `trySuspendFastPath`, engine intercepts before the moderator)
- `step ask` adapter contract (`--mode fork --session ...`, `--mode ask --session ... --prompt ...`)
- adapter-owned LLM config at `~/.uwf/agents/<name>.yaml` (engine config is LLM-free)
- failed-step retry path (`$status: error`, `previousAttempts`, `@uwf/thread-failed/`, head not advanced on `isError`)
- `AgentRunResult` with all 5 fields and `Usage` shape
- realistic `run()` skeleton replacing the empty placeholder
- `isFirstVisit` semantics and re-entry pattern
- "fast path" jargon replaced with "frontmatter extraction" / "suspend interception" before the symbol names appear
- removed undefined `textSchema`/`detailSchema` references; show `registerAgentSchemas`/`schemas.text` real APIs
- `AdapterOutput` JSON-stdout envelope, `storageRoot`/`casDir`, `UWF_HOME`/`OCAS_HOME` propagation

Adds 36 targeted assertions in `packages/cli/src/__tests__/prompt.test.ts` covering every issue item.
