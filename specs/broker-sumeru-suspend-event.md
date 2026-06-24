---
scenario: "Broker sumeru-client consumes the SSE `suspend` terminal event into a SumeruSendOutcome carrying suspend info"
feature: broker
tags: [broker, sumeru, sse, suspend, parsing, phase2]
---

## Given
- RFC #95 (sumeru) defines `suspend` as a fourth **terminal** SSE event, parallel to
  `done`/`error` (NOT parallel to `turn`). Phase 1 (sumeru #97, merged) makes the sumeru
  server emit it on send timeout. Its wire frame is a single SSE event:
  ```
  event: suspend
  data: {"type":"@sumeru/suspend","value":{"reason":"timeout","nativeId":"<sumeru-native-session-id>","elapsedMs":<number>}}

  ```
  `suspend` is always the **last** frame of the stream — the stream closes right after it.
- Before this change, `packages/broker/src/sumeru-client/sumeru-client.ts` `handleEvent`'s
  `switch (evt.event)` (around line 405) had no `case "suspend"`, so a `suspend` frame fell to
  `default` and returned the empty `EventOutcome` — silently dropped. `finalizeOutcome` then
  threw `sumeru SSE stream ended ... without done or error`.
- This change adds, mirroring `parseErrorEvent` (around line 491):
  - a `parseSuspendEvent(data, base)` parser that validates the `@sumeru/suspend` envelope and
    extracts `reason` (`"timeout"`), `nativeId` (string), `elapsedMs` (number);
  - a `case "suspend": return parseSuspendEvent(evt.data, empty);` arm in `handleEvent`;
  - a `suspend: SumeruSuspendValue | null` field on the internal `EventOutcome` type
    (around lines 391–396), defaulted to `null` in the `empty` base;
  - a new exported `SumeruSuspendValue = Readonly<{ reason: "timeout"; nativeId: string; elapsedMs: number }>`
    in `packages/broker/src/sumeru-client/types.ts`;
  - accumulation of `suspend` in `SseState` via `applyOutcome` (around line 217), with
    `isStreamFinished` treating a non-null `suspend` as a terminal condition (like `done`);
  - `finalizeOutcome` (around line 277) returning a `SumeruSendOutcome` that carries the
    suspend info instead of throwing.
- `SumeruSendOutcome` (`types.ts` 70–82) becomes a discriminated union (or otherwise makes
  "suspended ⇒ no `done`" hold at the type level): a completed outcome carries
  `output`/`assistantTurnCount`/`assistantTurns`/`done`; a suspended outcome carries the
  `SumeruSuspendValue` and no `done`. Assistant turns observed before the timeout are still
  retained on the suspended outcome (Phase 3 deepens retention semantics; this Phase at least
  does not drop already-collected turns).

## When
- The mocked Sumeru SSE stream emits, in order: a `user` turn, two `assistant` turns
  (`"draft1"`, `"draft2"`), then a `suspend` frame with
  `{"reason":"timeout","nativeId":"ses_native_abc","elapsedMs":1800000}` — and no `done` frame:
  ```typescript
  const outcome = await client.sendMessage({ gateway, sessionId, content }, onAssistantTurn);
  ```

## Then
- `parseSuspendEvent` unit: given the verbatim `data` above it returns an `EventOutcome` whose
  `suspend` is `{ reason: "timeout", nativeId: "ses_native_abc", elapsedMs: 1800000 }` and whose
  `done`/`errorMessage` stay `null`.
- A `suspend` frame with malformed JSON in `data` terminates the stream with an error message
  like `sumeru SSE suspend event has malformed JSON: <first 200 chars>` (mirrors
  `parseErrorEvent`/`parseDoneEvent`).
- A frame whose envelope `type` is not `@sumeru/suspend` (or whose `value` is missing the
  required fields) is treated as a parse error (`sumeru SSE suspend event missing @sumeru/suspend envelope`),
  matching the strictness of `parseDoneEvent`.
- After `consumeSse` drains the stream above, the accumulated state's `suspend` is non-null and
  `done` is null; `isStreamFinished` returned `true` at the `suspend` frame (later frames, if any,
  are not consumed).
- `finalizeOutcome` does **not** throw for this stream. It returns a `SumeruSendOutcome` whose
  discriminant marks it suspended, carrying `reason: "timeout"`, `nativeId: "ses_native_abc"`,
  `elapsedMs: 1800000`, and the assistant turns seen before timeout
  (`["draft1","draft2"]` by `.content`). It carries no `done`.
- Completed streams (ending in `done`) are unchanged: `finalizeOutcome` still returns the
  completed-variant outcome with `output` = last assistant turn and the `done` summary; the
  `suspend` field is absent/null on that variant.

## Notes
- This is the broker entry point for Phase 2: it translates the protocol-level `suspend` event
  into a typed outcome. The downstream `SendResult` discriminated union is specified in
  `broker-send-result-suspended.md`; the CLI's `$SUSPEND` wiring in
  `cli-broker-step-suspend-to-thread-suspended.md`.
- Phase 1 (sumeru) still SIGKILLs the process on timeout; `suspend` records `nativeId` for a
  future `--resume`, it does not freeze the process.
