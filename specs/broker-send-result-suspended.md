---
scenario: "broker.send() returns a discriminated SendResult — kind:completed (with done) or kind:suspended (with reason/nativeId/elapsedMs, no done)"
feature: broker
tags: [broker, send, sumeru, sse, suspend, result, discriminated-union, phase2]
---

## Given
- Before this change, `SendResult` (`packages/broker/src/send/types.ts` 78–99) was a single
  `Readonly<{ output; sessionId; reused; assistantTurnCount; turns; done }>` record — `done`
  was always required, encoding the assumption that every `send()` completes.
- Per the supervisor-confirmed design (issue #435, option 3), `SendResult` is refactored into a
  **discriminated union** on a `kind` field so that "suspended ⇒ no `done`" holds at the type
  level (uwf convention: expected branches use Result types, not exceptions; `done` stays
  required on the completed branch):
  ```typescript
  export type SendResult =
    | {
        kind: "completed";
        output: string;
        sessionId: string;
        reused: boolean;
        assistantTurnCount: number;
        turns: readonly BrokerTurn[];
        done: SumeruDoneValue;
      }
    | {
        kind: "suspended";
        sessionId: string;
        reused: boolean;
        reason: "timeout";
        nativeId: string;
        elapsedMs: number;
        turns: readonly BrokerTurn[]; // turns produced before the timeout
      };
  ```
- `buildResult` (`packages/broker/src/send/send.ts` ~220) branches on whether the
  `SumeruSendOutcome` is suspended (see `broker-sumeru-suspend-event.md`): a completed outcome
  builds a `kind:"completed"` result; a suspended outcome builds a `kind:"suspended"` result.
- The `suspended` branch has **no** `done`, no `output`, no `assistantTurnCount` — accessing them
  is a TypeScript error unless the caller first narrows `kind === "completed"`.

## When
- Two `broker.send({ threadId, role, prompt, onTurn })` calls are exercised against a mocked
  sumeru-client:
  1. a stream ending in `done` (assistant turns `"draft1"`,`"draft2"`,`"final"`);
  2. a stream ending in `suspend` (`reason:"timeout"`, `nativeId:"ses_native_abc"`,
     `elapsedMs:1800000`) after assistant turns `"draft1"`,`"draft2"` and no `done`.

## Then
- Call 1 returns `result.kind === "completed"`, with `output === "final"`, `done` populated
  from the sumeru summary, `assistantTurnCount === 3`, and
  `turns.map(t => t.content) === ["draft1","draft2","final"]` — identical values to the
  pre-change `SendResult` (completed path is a pure additive rename: a `kind` tag is added,
  nothing else changes).
- Call 2 returns `result.kind === "suspended"`, with `reason === "timeout"`,
  `nativeId === "ses_native_abc"`, `elapsedMs === 1800000`, `sessionId` set, and
  `turns.map(t => t.content) === ["draft1","draft2"]` (turns gathered before the timeout are not
  dropped). The object has **no** `done` / `output` / `assistantTurnCount` properties.
- The session-store mapping is still upserted for the suspended call (same `(threadId, role)`
  session the future resume will reuse) — suspend does not roll back the session record.
- Type-level: reading `result.done` or `result.output` without first narrowing
  `result.kind === "completed"` fails `pnpm run typecheck`. This is intentional — it forces every
  consumer to handle the suspended branch.

## Notes
- This is the broker's public surface for Phase 2. The internal SSE→outcome translation is
  `broker-sumeru-suspend-event.md`; the CLI consumer that turns `kind:"suspended"` into a
  thread-`suspended` state is `cli-broker-step-suspend-to-thread-suspended.md`.
- `BrokerTurn` and the `turns` snapshot semantics are unchanged from
  `broker-send-result-turns-full.md`; the suspended branch simply carries the partial list.
