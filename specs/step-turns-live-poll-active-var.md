---
scenario: "uwf step turns --role <r> --live polls the SQLite-backed @uwf/active-turns var, prints each new turn incrementally as it arrives, and exits when the step completes (active var deleted / thread no longer running)"
feature: step
tags: [cli, step-turns, turns, active-var, live, poll, sqlite, integration, phase4, "400"]
---

## Given
- Phase 4 of the realtime-turns RFC (`docs/rfc-realtime-turns.md`): "`--live` 轮询 active var，新 turn
  到达时打印（poll SQLite，非 SSE）". The live consumer **polls** the SQLite-backed active var; it
  does not open an SSE stream to Sumeru. This is the user-visible payoff of the whole RFC: watch a
  long-running step's progress with one CLI command instead of curling Sumeru or grepping a worktree.
- The active var `@uwf/active-turns/<threadId>/<role>` is persisted by the ocas SQLite var store at
  `~/.ocas/vars/_store.db` (table `vars`), which is **process-shared** under WAL — a second process
  sees each appended turn once the producer's read-modify-write commits, with no IPC
  (`cli-broker-step-cross-process-visibility.md`). So a polling reader in process B observes the list
  grow `1 → 2 → 3` while process A's step runs, and observes the var **disappear** when A solidifies
  + deletes it on completion (`cli-broker-step-solidify-detail-turns.md`).
- Loop termination signal: a running step is marked by the background **running marker**
  (`createMarker` in `packages/cli/src/background/background.ts`; `isThreadRunning(storageRoot,
  threadId)` returns the marker while a `thread exec` holds it, `null` once `deleteMarker` runs in the
  `finally`). The thread var status is `"running"` during exec and flips to `"idle"`/`"end"` after.
  Either signal (active var deleted, or thread no longer running) marks step completion for `--live`.
- In a **multi-step** run (`uwf thread exec <tid> --count N`, N≥2) the running marker is held for the
  **entire loop** (`thread.ts`), so `isThreadRunning` stays truthy while the head StepNode advances
  through several roles (e.g. `planner → coder → reviewer`). The active var followed by `--live` is
  per-role, so the followed role's var is solidified+deleted when *its* step ends, while the thread
  remains "running" for subsequent roles — which is why the exit reconcile must check the head step's
  role (see `## Then`).
- Reuses the same per-turn renderer as `step read` (`loadTurnData` → `formatTurnBody`), so a live-
  printed turn block is identical to the same turn rendered by the non-live `step turns`
  (`step-turns-read-order-active-then-detail.md`).

## When
- Issue #400, Step 2 — process A runs a (paced) step in the background while process B follows it
  live:
  ```bash
  uwf thread exec <tid> --count 1 &        # process A: emits assistant turns over time
  uwf step turns <tid> --role coder --live # process B: follows the active var
  ```
- Test realization: a paced mock SSE (one assistant turn per interval, as in
  `broker-step-active-turns.test.ts`) drives `executeBrokerStep` so the active var grows over time,
  while `cmdStepTurns(storageRoot, tid, { role: "coder", live: true })` polls and accumulates the
  printed output. (The poll/exit logic SHOULD be unit-testable without a real second OS process —
  e.g. an injectable clock/poll-interval and a stop predicate driven by the active var + running
  marker.)

## Then
- **Incremental, de-duplicated printing**: on each poll tick `--live` re-reads
  `readActiveTurns(store, tid, role)` and prints **only turns not already printed** (it tracks how
  many turn blocks it has emitted and renders the new tail). Over the run, process B prints `t1`,
  then later `t2`, then `t3` — each exactly **once**, in arrival order — not the whole list re-dumped
  each tick. The first tick MAY print the backlog already present when `--live` started.
- Each printed turn uses the reused renderer: a `## Turn N` block with `**Turn role:** assistant`
  and the turn `content`, byte-identical to what non-live `step turns` / `step read` would render for
  that turn node.
- **Exit on completion**: when process A's step finishes — active var deleted (solidified into
  `detail.turns`) and/or `isThreadRunning(<tid>) === null` / thread status no longer `"running"` —
  the `--live` command **stops polling and exits 0**. It does not hang forever, and it does not
  reprint the now-frozen `detail.turns` as a fresh batch on exit (the turns were already streamed
  from the active var).
- **Exit reconcile is role-aware (multi-step runs):** across a multi-step run
  (`uwf thread exec <tid> --count N`, N≥2) the running marker is held for the **whole loop**, so the
  thread is still "running" while the head advances through several roles. When `--live --role <r>`
  finally exits, its reconcile flush of the head step's `detail.turns` MUST go through the same
  **role-aware** `readHeadDetailTurns` (head used only when `headStepNode.role === r`). A
  `--live --role coder` follower therefore **never** emits the final step's (e.g. `reviewer`) turns
  as continued "coder" turns: if the head step at exit is a *different* role than the one being
  followed, the reconcile contributes `[]` (the coder turns were already streamed from the coder
  active var before the head moved on). This is the same root cause and fix as the non-live detail
  fallback (`step-turns-role-selection.md`, review blocking issue #1/#2).
- **No turn lost across the active→detail handoff**: every assistant turn produced by the step is
  printed exactly once by the live follower; after exit, the same turns are durably queryable via the
  non-live path (`uwf step turns <tid> --role coder` now reading `detail.turns`) — closing the loop
  with `step-turns-read-order-active-then-detail.md`.
- Polling is bounded and SQLite-only: each tick is a `readActiveTurns` (var list + one `cas.get` of
  the array node) plus a running-marker check; no Sumeru HTTP/SSE call is made by the consumer. The
  poll interval is a small fixed default (implementation choice, e.g. a few hundred ms) and SHOULD be
  injectable for tests.

## Notes
- Starting `--live` **after** the step already completed (active var already gone) degrades to the
  non-live completed-case: it prints `detail.turns` once and exits 0 — `--live` never blocks waiting
  for a var that will never appear. (It MAY first check the running marker / head detail so a
  finished thread returns immediately.)
- The RFC explicitly chose **poll SQLite, not SSE** for the consumer: the SSOT is uwf's OCAS/var
  store, which may live on a different device than Sumeru; polling the local var needs no live
  connection to the agent host (RFC appendix B).
- Exit-condition robustness: relying on `isThreadRunning` (which auto-clears stale/dead-PID markers)
  in addition to active-var-absence avoids a hang if a producer crashes between its last append and
  solidification — the marker disappears when the producer process dies, so `--live` still exits.
- This is the integration-level acceptance for issue #400 Step 2; the unit-level guarantees it builds
  on (append ordering, solidify+delete, cross-process visibility) are the #398 specs.
