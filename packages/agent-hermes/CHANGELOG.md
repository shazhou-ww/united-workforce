# @united-workforce/agent-hermes

## 0.3.1

### Patch Changes

- 621782c: chore: remove all bun residuals from scripts, examples, and source comments — unified on pnpm/node

## 0.3.0 — 2026-06-14

- Add `--timeout <seconds>` CLI flag and `UWF_HERMES_TIMEOUT=<seconds>` environment variable to `uwf-hermes` for configuring the per-prompt ACP `session/prompt` timeout (issue #358). Priority: `--timeout` flag > `UWF_HERMES_TIMEOUT` env > default (`10 * 60 * 1000` ms / 10 minutes, preserved as `DEFAULT_PROMPT_TIMEOUT_MS`). Values are interpreted as positive integer seconds; invalid values (non-numeric, zero, negative, decimal) cause `uwf-hermes` to exit non-zero with a descriptive error. Long-running roles (e.g. release publishers driving `proman publish`) can now extend the bound without recompiling. Resolution lives in a pure `resolveHermesTimeoutMs(argv, env)` helper for unit-testability, and the suspend message (`hermes prompt timed out after <minutes> minutes`) is derived from the resolved value. The flag is consumed in `cli.ts` before delegating to the shared agent runner, so it does not collide with `--thread`, `--role`, or `--prompt`. No effect on other adapters (`uwf-claude-code`, `uwf-builtin`).

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

## 0.1.5 — 2026-06-07

- fix: decouple session resume from isFirstVisit guard

  When frontmatter validation fails, the step is never written to CAS, so isFirstVisit remains true on the next run. Both adapters now always check the session cache regardless of isFirstVisit. When resuming after a frontmatter-only failure (isFirstVisit + cache hit), a minimal correction prompt is sent via buildFrontmatterRetryPrompt() instead of re-sending the full initial prompt.

## 0.1.1

### Patch Changes

- 8085d1d: fix: read token usage from ACP PromptResponse instead of DB

  Token counts (inputTokens, outputTokens) now come from the ACP
  `PromptResponse.usage` field, which is populated synchronously from
  `run_conversation()` return data — no WAL race condition.

  Turns (assistant message count) still come from the DB via
  `snapshotTurns()` before/after delta.

  Previously both tokens and turns were read from the Hermes state DB
  after the ACP prompt returned, but due to WAL write lag the DB often
  had incomplete token data at read time (e.g. 235 vs actual 26,080).
