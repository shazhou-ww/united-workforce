---
scenario: "SendResult exposes the full ordered list of assistant turns while output stays the last one (backward compatible)"
feature: broker
tags: [broker, send, sumeru, sse, turns, result, phase1, backward-compat]
---

## Given
- Before Phase 1, `SendResult` (`packages/broker/src/send/types.ts`) carried only `output`,
  `sessionId`, `reused`, `assistantTurnCount`, and `done`. The intermediate assistant turns
  parsed by `consumeSse` were accumulated then discarded — only the last survived as `output`
  (see `broker-sumeru-sse-turn-extraction.md`).
- Phase 1 adds a field to `SendResult`:
  ```typescript
  /** Full ordered list of assistant turns observed in the SSE response. */
  turns: readonly BrokerTurn[];
  ```
  where `BrokerTurn` is the type defined in `broker-send-on-turn-callback.md`
  (`{ index, role, content, hash, timestamp }`).
- The list is **assistant-turn-scoped** and in **arrival order** — the same population and
  ordering as the `onTurn` callbacks. This scoping is what makes the invariants below hold
  for every stream (since `output` and `assistantTurnCount` are defined over assistant turns
  in the existing `finalizeOutcome`).
- The threading is: `consumeSse` collects each applied assistant turn into its `SseState`,
  `finalizeOutcome` returns them on `SumeruSendOutcome`, and `buildResult`
  (`packages/broker/src/send/send.ts`) copies them onto `SendResult.turns`. `output` continues
  to be the **last** assistant turn's `content`.

## When
- The mocked Sumeru SSE stream emits, in order: one `user` turn, then assistant turns with
  content `"draft1"`, `"draft2"`, `"final"` (each with a non-empty `hash`), then a `done` frame; and
  ```typescript
  const result = await broker.send({ threadId, role, prompt, onTurn: null });
  ```

## Then
- `result.turns.length === result.assistantTurnCount` — here both are `3`. (The leading `user`
  turn is excluded from `turns`.)
- `result.turns[result.turns.length - 1].content === result.output` — the last entry's `content`
  equals `output` (`"final"`), preserving backward compatibility.
- `result.turns` preserves arrival order: `["draft1", "draft2", "final"]` by `.content`.
- Every entry's `hash` is the verbatim Sumeru `value.hash` (non-empty for these frames); every
  entry's `role` is `"assistant"`.
- `result.output`, `result.sessionId`, `result.reused`, `result.assistantTurnCount`, and
  `result.done` retain their prior meaning and values — `turns` is purely additive.
- The general invariant holds across stream shapes: for any successful `send()`,
  `result.turns.length === result.assistantTurnCount` and, when `assistantTurnCount > 0`,
  `result.turns[last].content === result.output`.

## Notes
- This is Step 2 of issue #397's acceptance. `turns` is a full snapshot returned at the end;
  the realtime delivery of the same data is the `onTurn` callback (Step 1).
- `done.turnCount` (from the Sumeru summary) counts ALL turns including `user`/`system` and is
  unrelated to `turns.length` / `assistantTurnCount`; the spec does not equate them.
