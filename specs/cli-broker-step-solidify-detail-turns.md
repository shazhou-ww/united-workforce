---
scenario: "on step completion, storeBrokerDetail solidifies the full active-turns list into the immutable detail node (detail.turns = all turn hashes, turnCount = turns.length) and deletes the active var"
feature: thread
tags: [cli, broker-step, turns, active-var, detail, solidify, phase2, "398"]
---

## Given
- Phase 2 of the realtime-turns RFC (`docs/rfc-realtime-turns.md`). Builds on
  `cli-broker-step-active-turns-realtime.md`: during the send, broker-step's `onTurn` callback has
  appended each assistant turn hash to `@uwf/active-turns/<threadId>/<role>`.
- Current (pre-#398) `storeBrokerDetail` in `packages/cli/src/commands/broker-step.ts`
  (lines ~331–351) is **seal-style** — it records exactly **one** assistant turn from the final
  output and hardcodes `turnCount: 1`:
  ```typescript
  const turn = { role: "assistant", content: result.output };
  const turnHash = await uwf.store.cas.put(turnSchemaHash, turn);
  const detail = {
    sessionId: result.sessionId,
    duration: Math.max(0, completedAtMs - startedAtMs),
    turnCount: 1,                 // ← always 1
    turns: [turnHash],            // ← always the single last turn
  };
  ```
- `DETAIL_SCHEMA` (lines ~67–81) is `{ sessionId, duration, turnCount: integer, turns: ocas_ref[] }`,
  `additionalProperties: false` — already an **array** of refs, so no schema change is required to
  hold many turn hashes.
- `storeBrokerDetail` is called once per step from `executeBrokerStep` (currently lines ~537–542),
  on **both** the success and the frontmatter-failure paths (the detail is written before the error
  branch). The active var name is derivable inside `storeBrokerDetail` from `threadId` + `role`.

## When
- A unit test drives `executeBrokerStep` against a mock broker whose SSE stream emits **3 assistant
  turns** (`"t1"`, `"t2"`, `"t3"`) then a `done` frame, where the final turn `"t3"` carries valid
  YAML frontmatter matching the role's output schema (so extraction succeeds on the primary send,
  no retries).
- After `executeBrokerStep` resolves, the test reads the persisted detail node
  (`uwf.store.cas.get(result.detailHash)`) and re-queries the active var
  `uwf.varStore.list({ exactName: "@uwf/active-turns/<tid>/<role>" })`.
- Verification (issue #398, Step 2): the same `npx vitest run packages/cli -t "active-turns"` run.

## Then
- `storeBrokerDetail` reads the **full** ordered turn-hash list from
  `@uwf/active-turns/<tid>/<role>` (resolving the var → its array node) and writes **all** of them
  into the immutable detail node:
  - `detail.turns` is the ordered array of **all 3** turn hashes — `detail.turns.length === 3` —
    not a single sealed turn. Order matches arrival: contents `["t1", "t2", "t3"]`.
  - `detail.turnCount === detail.turns.length === 3` — **no longer hardcoded to 1**.
  - Each `detail.turns[i]` is gettable in CAS as a `{ role: "assistant", content }` node.
  - `detail.sessionId` and `detail.duration` (`= max(0, completedAtMs - startedAtMs)`) keep their
    current meaning, and the detail still validates against the unchanged `DETAIL_SCHEMA`.
- After solidification the active var is **deleted**: `uwf.varStore.list({ exactName:
  "@uwf/active-turns/<tid>/<role>" })` returns `[]` (the mutable pointer is gone once its contents
  are frozen into the immutable detail — RFC: "然后删除 active var"). The deletion uses
  `varStore.remove(...)`.
- The detail node is immutable CAS: the solidified `detail.turns` array equals the active var's
  contents captured **at completion time** and does not change afterward.
- `uwf step show <stepHash>` / the step-detail output envelope therefore surfaces all 3 turns:
  `detail.turnCount === 3` and the `turns` array has 3 entries (each validating against the
  permissive `STEP_DETAIL_TURN` shape; see `step-detail-output-schema` card). This is the
  user-visible payoff: the full turn history is frozen into the step, not just the last line.

## Notes
- Ordering invariant: because Phase 1 delivers assistant turns in arrival order and the final
  assistant turn's `content === result.output`, the **last** element of the solidified
  `detail.turns` is the same content the legacy seal-style path used as its single turn — so
  `extractStepContent` (which scans `turns` newest-first for the last assistant turn) keeps
  returning the final answer. Backward compatible for readers that only want the last turn.
- The active var must be deleted on **completion of the step**, including the
  frontmatter-extraction-failure path (`storeBrokerDetail` runs before the error branch), so a
  failed step does not leak an active var that a later attempt would wrongly inherit — though the
  primary defense against stale turns is the start-of-step clear
  (`cli-broker-step-crash-rerun-clears-active-var.md`).
- Edge case (documented, not the headline assertion): if a step produced **zero** assistant turns
  (no `onTurn` fired — e.g. the active var was never created), `detail.turns` is the empty list and
  `detail.turnCount === 0`; the step still persists. The 3-turn happy path above is the asserted
  acceptance.
