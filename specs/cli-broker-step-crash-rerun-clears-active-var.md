---
scenario: "a crash-rerun is a fresh attempt: broker-step clears @uwf/active-turns/<tid>/<role> at the start of the step, so stale turns from a failed prior attempt are dropped and never appended to"
feature: thread
tags: [cli, broker-step, turns, active-var, crash, rerun, attempt-isolation, phase2, "398"]
---

## Given
- Phase 2 of the realtime-turns RFC (`docs/rfc-realtime-turns.md`). Builds on
  `cli-broker-step-active-turns-realtime.md` (append) and
  `cli-broker-step-solidify-detail-turns.md` (solidify + delete).
- The active var `@uwf/active-turns/<threadId>/<role>` is a **mutable pointer for the in-flight
  attempt**. A step can crash mid-flight (e.g. `exec` killed) **after** some turns were appended
  but **before** `storeBrokerDetail` solidified + deleted the var — leaving a **stale** active var
  whose turns belong to a now-failed attempt.
- RFC design decision: "**step 开始先清空 active var**（crash 重跑是新 attempt，旧 turn 属于失败
  attempt，不接续 append）". Re-running the same `(threadId, role)` step is a **new attempt** and
  must **not** continue appending onto stale turns.
- The clear happens **once at the start** of `executeBrokerStep`
  (`packages/cli/src/commands/broker-step.ts`), **before** the primary `broker.send`, i.e. before
  any `onTurn` can fire. It clears via `varStore.remove("@uwf/active-turns/<tid>/<role>")` (a
  remove of a missing var is a no-op, so a clean first run is unaffected).
- Critical scope: the clear is **start-of-step only**, NOT per-`broker.send`. Frontmatter retries
  inside the same `executeBrokerStep` re-send on the cached Sumeru session and must **keep
  appending** to the same attempt's var (see `cli-broker-step-active-turns-realtime.md` Notes) — so
  the clear cannot live inside the send/retry loop.

## When
- A unit test **seeds a residual active var**: it pre-creates `@uwf/active-turns/<tid>/<role>`
  pointing at an array node of **2 stale turn hashes** (e.g. contents `"old1"`, `"old2"`),
  simulating a crashed prior attempt.
- The test then drives `executeBrokerStep` for the **same** `(threadId, role)` against a mock
  broker whose SSE stream emits **3 new assistant turns** (`"new1"`, `"new2"`, `"new3"`) then
  `done`, with the final turn carrying valid frontmatter (extraction succeeds).
- After it resolves, the test reads the solidified detail (`uwf.store.cas.get(result.detailHash)`)
  and resolves each `detail.turns[i]` content. (Issue #398, Step 3.)

## Then
- At the **start** of `executeBrokerStep`, the seeded `@uwf/active-turns/<tid>/<role>` is cleared
  before the first `broker.send`, so no new turn is appended on top of the stale `["old1","old2"]`.
- After the 3 new callbacks, the active var holds **exactly** `[hash(new1), hash(new2),
  hash(new3)]` — length 3, contents `["new1","new2","new3"]` — the stale 2 are gone (they were not
  carried over).
- The solidified `detail.turns` contains **only the new 3**: `detail.turns.length === 3`,
  `detail.turnCount === 3`, resolved contents `["new1","new2","new3"]`, and **none** of `"old1"` /
  `"old2"` appears. (The stale turns' CAS nodes may still exist in the immutable store, but they
  are **not referenced** by this attempt's detail.)
- A clean first run (no residual var) is unaffected: clearing a non-existent
  `@uwf/active-turns/<tid>/<role>` is a no-op, and the step proceeds to append `new1..new3`
  normally — i.e. the clear never deletes a *current*-attempt turn (it runs before any fire).

## Notes
- Attempt isolation here is about the **active var pointer**, which is `(threadId, role)`-keyed and
  shared across reruns; it is distinct from the StepNode's `previousAttempts` lineage (those are
  immutable CAS step nodes for poke/retry semantics). Phase 2 only governs the mutable turn list.
- Two complementary cleanups guarantee no stale leakage: **start-of-step clear** (this spec,
  primary defense against an orphaned var from a crash) and **post-solidify delete**
  (`cli-broker-step-solidify-detail-turns.md`, cleanup on the success/normal path). Either alone
  leaves a gap; together the in-flight var only ever holds the current attempt's turns.
- The clear targets the **exact** `(threadId, role)` var only — it must not wipe active vars for
  other roles or other threads (different `@uwf/active-turns/...` names) running concurrently.
