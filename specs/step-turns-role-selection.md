---
scenario: "uwf step turns selects which active-turns var to read via --role; the role keys the @uwf/active-turns/<tid>/<role> var, and concurrent roles on the same thread are addressed independently"
feature: step
tags: [cli, step-turns, turns, active-var, role, phase4, "400"]
---

## Given
- Phase 4 of the realtime-turns RFC (`docs/rfc-realtime-turns.md`). The active-turns var is keyed by
  **both** thread id and role: `activeTurnsVarName(threadId, role) =
  "@uwf/active-turns/<threadId>/<role>"` (`packages/cli/src/store.ts`, #398). A single thread can
  therefore have multiple concurrent active-turns vars — one per role that has run/ is running.
- `readActiveTurns(store, threadId, role)` reads **exactly** the `(threadId, role)` var; it does not
  merge across roles. `clearActiveTurns` / `appendActiveTurn` are likewise role-scoped (Phase 2:
  "Targets the exact `(threadId, role)` var only — concurrent active vars for other roles/threads
  are untouched").
- broker-step appends turns under the role the moderator resolved for the step
  (`executeBrokerStep`'s `args.role`), so the var name's `<role>` segment is the workflow role name
  (e.g. `coder`, `planner`, `reviewer`).
- A thread `06FCY...` mid-run has two active-turns vars seeded:
  `@uwf/active-turns/06FCY.../coder` → `[h(c1), h(c2)]` and
  `@uwf/active-turns/06FCY.../planner` → `[h(p1)]`.

## When
- The user scopes the query to a role:
  ```bash
  uwf step turns 06FCY... --role coder
  uwf step turns 06FCY... --role planner
  ```
- Unit test (issue #400, Step 1) — drives `cmdStepTurns(storageRoot, threadId, { role, live:false })`
  once per role against the two-role seed above.

## Then
- `--role coder` renders **only** the coder var's turns — 2 turns whose contents are
  `["c1", "c2"]`, in order — and never the planner turn.
- `--role planner` renders **only** the planner var's turn — 1 turn whose content is `"p1"`.
- The role passed on the CLI is threaded verbatim into `activeTurnsVarName(threadId, role)` /
  `readActiveTurns(..., role)`; selecting a role with no active var (and no matching completed step
  detail) yields an empty turn list rendered without error (exit 0), not a crash.
- Role handling is exact-match on the var-name segment: `--role coder` does not match
  `@uwf/active-turns/06FCY.../coder-2` or any other role; the lookup is `exactName`-scoped (Phase 2
  `readActiveTurns` uses `store.var.list({ exactName })`).

## Notes
- Whether `--role` is **required** or **defaulted** (e.g. to the thread's current/last role from the
  head StepNode) is an implementation choice; the asserted contract is that **when a role is given
  it deterministically selects the matching `(threadId, role)` var**. If a default is offered, it
  MUST still resolve to a single concrete role before calling `readActiveTurns` (the var is
  per-role, never a wildcard). A sensible default is the role of the running/head step so that
  `uwf step turns <tid>` with no `--role` "does the obvious thing" for a single-role-in-flight
  thread.
- This per-role scoping is what lets `--live` (see `step-turns-live-poll-active-var.md`) follow one
  role's progress while another role's turns accumulate independently on the same thread.
