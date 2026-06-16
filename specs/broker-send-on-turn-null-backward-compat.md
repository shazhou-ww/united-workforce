---
scenario: "onTurn=null (or omitted) preserves the exact pre-Phase-1 broker behavior; existing send tests stay green"
feature: broker
tags: [broker, send, sumeru, sse, turns, backward-compat, phase1, regression]
---

## Given
- Phase 1's realtime-turns change must be **strictly additive**: when the caller passes no
  callback, broker behavior is identical to before the change. The RFC states "callback 为 null
  时行为与现在完全一致".
- `SendArgs.onTurn` is typed `((turn: BrokerTurn) => void) | null`. Existing call sites that pass
  `{ threadId, role, prompt }` without `onTurn` must continue to type-check and run — i.e. the new
  field is introduced in a way that does not force every existing caller/test to add `onTurn`
  (e.g. callers may pass `onTurn: null`, and the existing in-repo `send` tests are updated minimally
  or remain valid). The tester's gate is that the FULL existing broker suite passes.
- When `onTurn` is `null`, `consumeSse` performs no callback invocation on the assistant-turn
  apply path; the only added work is accumulating `turns` into `SseState` (cheap, already needed
  for `SendResult.turns`).

## When
- Step 3 verification command from issue #397 / RFC Phase 1 (whole broker suite, no grep filter):
  ```bash
  cd ~/repos/united-workforce && npx vitest run packages/broker
  ```
- And specifically, a `send` / `sendMessage` exchange runs with `onTurn` set to `null` (or the
  field absent at the call site).

## Then
- **All pre-existing broker tests pass unchanged** — `__tests__/send.test.ts`,
  `__tests__/sumeru-client-send-message.test.ts`, `__tests__/sumeru-client-create.test.ts`,
  `__tests__/sumeru-client-create-session.test.ts`, `__tests__/session-store.test.ts`,
  `__tests__/public-api.test.ts`. No assertion in those files needs to change to accommodate
  Phase 1 (aside from optionally threading an explicit `onTurn: null`).
- With `onTurn: null`, `result.output` is still the last assistant turn's `content`,
  `result.assistantTurnCount` is unchanged, `result.done` is unchanged, and the SSE timeout /
  heartbeat-watchdog behavior (issue #391) is unaffected — no callback means no behavioral delta
  beyond the new (still-populated) `result.turns` field.
- No callback is ever invoked when `onTurn` is `null` (a spy/`expect(...).not.toHaveBeenCalled()`
  style assertion holds — there is simply nothing to call).
- The error paths are unchanged: malformed `turn` JSON, missing `role`/`content`, premature close,
  and SSE `error` frames reject exactly as specified by the existing client specs, regardless of
  whether `onTurn` is set.

## Notes
- This is Step 3 of issue #397. It is the regression guard ensuring the additive change does not
  alter the established `output` = last-assistant-turn contract or the existing error semantics.
