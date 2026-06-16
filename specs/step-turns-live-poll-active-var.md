---
scenario: "uwf step turns <thread-id> --live renders the chain panorama then follows the in-flight step's @uwf/active-turns var, printing each new turn once and updating the step's 🔄 进行中 marker, exiting when the step completes (active var deleted / thread no longer running)"
feature: step
tags: [cli, step-turns, turns, active-var, live, poll, sqlite, chain, progress-marker, "409", "400"]
---

## Given
- Issue #409: `step turns` is the whole-chain panorama
  (`step-turns-chain-panorama.md`), and `--live` "跟住「进行中」的 step 实时刷新"
  — it follows the **in-flight** step (the one whose `@uwf/active-turns/<tid>/<role>`
  var is present) and refreshes its turns in real time.
- The live consumer **polls** the SQLite-backed active var (RFC: "poll SQLite,
  非 SSE"); it does not open an SSE stream to Sumeru. The var
  `@uwf/active-turns/<threadId>/<role>` is persisted by the ocas SQLite var store
  (`~/.ocas/vars/_store.db`, WAL, process-shared), so a second process sees each
  appended turn once the producer's read-modify-write commits, and sees the var
  **disappear** when the producer solidifies + deletes it on completion
  (`cli-broker-step-cross-process-visibility.md`,
  `cli-broker-step-solidify-detail-turns.md`).
- Loop-termination signal: the background running marker — `isThreadRunning(
  storageRoot, threadId)` returns the marker while a `thread exec` holds it,
  `null` once `deleteMarker` runs in the `finally`. Either signal (the followed
  step's active var deleted, or the thread no longer running) ends the follow.
- In a **multi-step** run (`uwf thread exec <tid> --count N`, N≥2) the running
  marker is held for the **whole loop** while the head advances through several
  roles. The followed step's per-role active var is solidified+deleted when *its*
  step ends, while the thread stays "running" for subsequent roles.
- Reuses the same per-turn renderer as `step read` (`loadTurnData` →
  `formatTurnBody`), so a live-printed turn block is identical to the same turn
  rendered by non-live `step turns` / `step read`.

## When
- The user watches a running thread's in-flight step:
  ```bash
  uwf thread exec <tid> --count 1 &     # process A: emits assistant turns over time
  uwf step turns <tid> --live           # process B: follows the in-flight step
  ```
- Test realization: a paced mock SSE (one assistant turn per interval, as in
  `broker-step-active-turns.test.ts`) drives `executeBrokerStep` so the active
  var grows over time, while `cmdStepTurns(storageRoot, tid, { live: true, ... })`
  polls and accumulates printed output. The poll/exit logic is unit-testable
  without a real second OS process via an injectable clock/poll-interval and a
  stop predicate driven by the active var + running marker (the existing
  `pollIntervalMs` / `sleep` / `isRunning` / `onChunk` injection points).

## Then
- **Identifies the in-flight step from the active var**: `--live` follows the
  step whose `(threadId, role)` active var is present. With `--role <r>` it
  follows that role's step; without `--role` it follows the thread's current
  in-flight step (the role of the running/head step). The already-completed
  steps of the panorama are rendered (from their `detail.turns`) as context
  before/around the live tail.
- **Incremental, de-duplicated printing**: on each poll tick `--live` re-reads
  `readActiveTurns(store, tid, role)` for the followed step and prints **only
  turns not already printed** (tracking how many turn blocks it has emitted,
  rendering the new tail). Over the run process B prints `t1`, then later `t2`,
  then `t3` — each exactly **once**, in arrival order — not the whole list
  re-dumped each tick. The first tick MAY print the backlog already present when
  `--live` started.
- **Step-level 进行中 marker**: the followed step is shown with the `🔄 进行中`
  marker (step-level granularity, never per-turn — a turn is whole or absent);
  when it completes the step's status resolves to `✓`. Each printed turn uses the
  reused renderer (`## Turn N` → `**Turn role:** assistant` → `content`),
  byte-identical to non-live `step turns` / `step read`.
- **Exit on completion**: when process A's step finishes — followed active var
  deleted (solidified into that step's `detail.turns`) and/or
  `isThreadRunning(<tid>) === null` / thread status no longer `"running"` —
  `--live` **stops polling and exits 0**. It does not hang forever, and it does
  not reprint the now-frozen `detail.turns` as a fresh batch on exit (those turns
  were already streamed from the active var).
- **Multi-step run, follow advances correctly**: across `exec --count N` (N≥2)
  the running marker is held for the whole loop. A `--live` follow of one role's
  step exits when **that** step completes; it **never** emits a *different*
  later role's turns as continued turns of the followed step — the reconcile on
  exit is scoped to the followed step's own turns (its active var / its
  `detail.turns`), so a `reviewer`-step follow does not spill `tester`/`committer`
  turns. (This is the same root-cause fix as the non-live per-step sourcing in
  `step-turns-read-order-active-then-detail.md`: turns are always scoped to their
  owning step, not to the moving head.)
- **No turn lost across the active→detail handoff**: every assistant turn the
  followed step produces is printed exactly once; after exit the same turns are
  durably queryable via the non-live panorama
  (`step-turns-read-order-active-then-detail.md`).
- Polling is bounded and SQLite-only: each tick is a `readActiveTurns` (var list
  + one `cas.get` of the array node) plus a running-marker check; no Sumeru
  HTTP/SSE call by the consumer. The poll interval is a small fixed default
  (`STEP_TURNS_POLL_INTERVAL_MS`) and is injectable for tests.

## Notes
- Starting `--live` **after** the followed step already completed (active var
  already gone) degrades to the non-live completed case for that step: it renders
  the step's `detail.turns` (within the panorama) and exits 0 — `--live` never
  blocks waiting for a var that will never appear.
- The RFC explicitly chose **poll SQLite, not SSE**: the SSOT is uwf's OCAS/var
  store, which may live on a different device than Sumeru; polling the local var
  needs no live connection to the agent host.
- Exit-condition robustness: combining active-var-absence with `isThreadRunning`
  (which auto-clears stale/dead-PID markers) avoids a hang if a producer crashes
  between its last append and solidification — the marker disappears when the
  producer dies, so `--live` still exits.
- `--live` composes with `--role` (follow that role's in-flight step); combining
  `--live` with `--limit`/`--offset` is a pagination-over-a-moving-tail edge —
  the headline `--live` contract is incremental de-duplicated printing + correct
  exit, with pagination semantics specified in `step-turns-pagination.md`.
