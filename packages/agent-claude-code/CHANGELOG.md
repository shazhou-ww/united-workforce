# Changelog

## 0.2.2

### Patch Changes

- Updated dependencies [aeb2449]
  - @united-workforce/protocol@0.4.0
  - @united-workforce/util-agent@0.3.0
  - @united-workforce/util@0.2.1

## 0.2.1 — 2026-06-12

- Fix unclear error from `uwf-claude-code` when the `claude` subprocess fails (e.g. user not logged in). The adapter now captures stderr and maps known patterns to actionable messages: `Not logged in` → `Claude Code is not logged in. Run \`claude login\` first.`, API key errors → `Claude Code API key error. Check your API key configuration.`, generic non-zero exits → `claude exited with code <n>: <truncated stderr>`. Demoted the full assembled prompt log (tag `K7R2M4N8`) to a short summary (role + length); the full prompt body is now only emitted when `UWF_DEBUG=1` is set, so prompt content no longer leaks into normal stderr or error messages. Closes #301.

## 0.2.0 — 2026-06-11

- feat(util-agent): extend AgentOptions with `fork` / `cleanup` and add ask-session cache

  Phase 2a infrastructure for `step ask`. Extends `AgentOptions` with
  `fork: AgentForkFn | null` and `cleanup: AgentCleanupFn | null` fields, exporting
  the new `AgentForkFn` and `AgentCleanupFn` type aliases. Adds `getAskSessionId` /
  `setAskSessionId` to the per-agent session cache, using `<stepHash>:ask` keys
  that share the cache file with exec sessions (`<threadId>:<role>` keys) without
  collision. All four adapters (mock, builtin, hermes, claude-code) now pass
  `fork: null, cleanup: null` — real implementations land in Phase 2b. Resolves
  issue #145.

- refactor(util-agent): hoist `buildSuspendOutput` into `util-agent`

  The `buildSuspendOutput(reason)` helper that produces the `$SUSPEND` frontmatter
  wire format was duplicated in both `agent-claude-code` and `agent-hermes`. Extract
  it into `@united-workforce/util-agent` (next to `trySuspendFastPath`) so the
  producer and consumer of the suspend wire format live in one place. Both adapters
  now import it; the obsolete local copies and now-unused `SUSPEND_STATUS` imports
  are removed. No user-visible behavior change.

- fix: report correct numTurns and duration in CC adapter (#220)

  - `assembleResult()` now uses `state.turns.length` (actual parsed streaming
    turns) instead of `resultLine.num_turns` (which CC reports as last-turn-only,
    always 1)
  - `processClaudeOutput()` now uses wall-clock elapsed time instead of
    `parsed.durationMs` from the result line (which is also last-turn-only)
  - Token usage (`inputTokens`/`outputTokens`) still comes from the result line —
    CC's streaming events do not include per-turn token counts, so there is no
    cumulative source available

- Pass `cwd` to Claude Code `spawn()` so it starts in the correct worktree directory instead of inheriting from the parent process.
- feat(workflow)!: `$SUSPEND` becomes an engine-level reserved `$status` (coroutine yield)

  `$SUSPEND` is no longer a graph pseudo-role. Instead, any role may emit
  `{ $status: "$SUSPEND", reason: string }` from its output. The engine intercepts
  this status before the moderator: the step is written to CAS normally (head
  advances), the thread is marked `suspended` with the role and reason, and
  `thread resume` re-runs the same role — exactly like a coroutine yielding control
  back to its caller.

  For any role with frontmatter type `F`, the effective output type is
  `F | { $status: "$SUSPEND", reason: string }`. Suspend outputs are validated
  against a dedicated reserved schema, bypassing the role's own frontmatter schema.

  Adapters now yield instead of failing on resource limits:

  - `agent-claude-code`: an `error_max_turns` result emits `$SUSPEND` (preserving
    all turns and usage) instead of throwing.
  - `agent-hermes`: a prompt timeout emits `$SUSPEND` instead of rejecting.

  BREAKING CHANGE: `"$SUSPEND"` is removed from `GraphPseudoRole` and is no longer a
  valid graph target role. Workflows using the old `role: "$SUSPEND"` edge pattern
  now fail validation with a migration hint — emit `$status: "$SUSPEND"` from the
  role output instead.

## 0.1.4 — 2026-06-07

- fix: decouple session resume from isFirstVisit guard

  When frontmatter validation fails, the step is never written to CAS, so isFirstVisit remains true on the next run. Both adapters now always check the session cache regardless of isFirstVisit. When resuming after a frontmatter-only failure (isFirstVisit + cache hit), a minimal correction prompt is sent via buildFrontmatterRetryPrompt() instead of re-sending the full initial prompt.
