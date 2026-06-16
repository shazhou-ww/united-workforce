---
"@united-workforce/broker": minor
---

feat(broker): expose per-turn realtime callback + `SendResult.turns` (#397)

Phase 1 of the realtime-turns RFC. `@united-workforce/broker` now surfaces
each assistant turn as it arrives on the Sumeru SSE stream, instead of only
returning the final `output` once `send()` resolves. Single-package, fully
backward-compatible, additive change.

New public type `BrokerTurn`:

```ts
type BrokerTurn = Readonly<{
  index: number;            // SSE value.index, or -1 when absent
  role: "user" | "assistant" | "system";
  content: string;          // SSE value.content, verbatim
  hash: string | null;      // Sumeru-computed value.hash, verbatim
  timestamp: string;        // SSE value.timestamp, or "" when absent
}>;
```

Two additions, both **assistant-turn-scoped** and in arrival order:

- **`SendArgs.onTurn: ((turn: BrokerTurn) => void) | null`** — fires
  synchronously inside the `consumeSse` reader loop, once per assistant turn,
  as each `turn` event is parsed and applied (not batched after `done`). All
  invocations complete before `send()` resolves. `null` ⇒ exact pre-Phase-1
  behavior (the only added work is accumulating `turns`).
- **`SendResult.turns: readonly BrokerTurn[]`** — the full ordered snapshot of
  the same assistant turns. Invariants: `turns.length === assistantTurnCount`
  and, when non-empty, `turns[turns.length - 1].content === output`.

`output`, `sessionId`, `reused`, `assistantTurnCount`, and `done` retain their
prior meaning and values — `turns` is purely additive. Non-assistant
(`user`/`system`) turns never fire `onTurn` and are excluded from `turns`.

`BrokerTurn` is exported from the package barrel
(`import { type BrokerTurn } from "@united-workforce/broker"`). Internally the
`sumeru-client` `sendMessage(args, onAssistantTurn?)` gained an optional
listener argument and `SumeruSendOutcome` gained `assistantTurns`, keeping all
existing single-arg call sites source-compatible.

CLI consumption of `onTurn` is Phase 2 — out of scope here.
