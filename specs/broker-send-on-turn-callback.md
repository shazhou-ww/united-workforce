---
scenario: "broker.send fires an onTurn callback in real time as each assistant turn arrives on the SSE stream"
feature: broker
tags: [broker, send, sumeru, sse, turns, callback, phase1]
---

## Given
- Phase 1 of the realtime-turns RFC (`docs/rfc-realtime-turns.md`): `@united-workforce/broker`
  must expose a per-turn callback so callers see progress as it happens, instead of waiting
  for the whole `send()` to resolve. Single-package change, no Sumeru dependency.
- The SSE wire format for a `turn` event is one frame (see existing
  `__tests__/fetch-stub.ts` `sseFrame` helper):
  ```
  id: <number>
  event: turn
  data: {"type":"@sumeru/turn","value":{"index":N,"role":"assistant","content":"...","timestamp":"...","toolCalls":...,"tokens":...,"hash":"<sumeru-hash>"}}

  ```
- A new public type **`BrokerTurn`** is exported from `packages/broker/src/send/types.ts` with
  exactly these fields (project convention: `T | null`, no optional `?:`):
  ```typescript
  export type BrokerTurn = Readonly<{
    index: number;            // SSE value.index, or -1 when absent
    role: "user" | "assistant" | "system";
    content: string;          // SSE value.content, verbatim
    hash: string | null;      // SSE value.hash (Sumeru-computed), verbatim
    timestamp: string;        // SSE value.timestamp, or "" when absent
  }>;
  ```
- `SendArgs` (`packages/broker/src/send/types.ts`) gains a field:
  `onTurn: ((turn: BrokerTurn) => void) | null`.
- The callback is **assistant-turn-scoped**: it fires once per `assistant` turn event applied,
  in arrival order. This scoping is required so the Step-2 invariants
  (`turns.length === assistantTurnCount`, `turns[last].content === output`) hold universally —
  see `broker-send-result-turns-full.md`. Non-assistant (`user`/`system`) turns do not fire
  `onTurn` (they remain counted only toward the internal total-turn tally).
- The callback is invoked **synchronously inside the SSE reader loop** of `consumeSse`
  (`packages/broker/src/sumeru-client/sumeru-client.ts`), at the moment each assistant `turn`
  event is parsed and applied — NOT batched after the `done` event. This is the realtime
  guarantee; it is plumbed from `SendArgs.onTurn` down through `sendMessage` into `consumeSse`.

## When
- A caller invokes:
  ```typescript
  const seen: BrokerTurn[] = [];
  const result = await broker.send({
    threadId,
    role,
    prompt,
    onTurn: (t) => { seen.push(t); },
  });
  ```
  and the mocked Sumeru SSE stream emits, in order, **N assistant `turn` frames** (each with a
  distinct non-empty `content` and a non-empty `hash`), then a terminating `done` frame.

## Then
- `onTurn` is invoked exactly **N times** — once per assistant turn (`seen.length === N`).
- The i-th invocation receives a `BrokerTurn` whose `content` equals the i-th SSE event's
  `value.content` **byte-for-byte** (no trimming, no JSON re-parse, no frontmatter extraction).
- Each delivered `turn.hash` is **non-empty** (the verbatim Sumeru-computed `value.hash` carried
  through; `BrokerTurn.hash` is `string | null` but is non-null whenever the SSE event supplies it).
- Callbacks arrive in **stream order** (assistant turn `index` is monotonically non-decreasing
  across the `seen` array), and all N callbacks complete **before** the `send()` promise resolves.
- Each delivered `turn.role` is `"assistant"` (non-assistant turns do not trigger `onTurn`).
- Verification command from issue #397 / RFC Phase 1:
  ```bash
  cd ~/repos/united-workforce && npx vitest run packages/broker --reporter=verbose 2>&1 | grep -i "onTurn\|per-turn"
  ```
  surfaces the new passing test(s) asserting the N-callbacks / content-match / non-empty-hash
  behavior above.

## Notes
- `onTurn` is called synchronously in the reader loop; the broker does not wrap it in
  `try/catch`. A throwing callback is the caller's responsibility (not part of issue #397's
  acceptance and not asserted by the tester).
