---
scenario: "broker-step's onTurn callback puts each assistant turn to CAS and appends its hash to the @uwf/active-turns/<tid>/<role> var in real time, so the list grows 1→2→3 as turns arrive"
feature: thread
tags: [cli, broker-step, turns, active-var, realtime, persistence, phase2, "398"]
---

## Given
- Phase 2 of the realtime-turns RFC (`docs/rfc-realtime-turns.md`, "Phase 2: uwf broker-step
  实时累积 + step 完成固化"). Depends on the already-merged Phase 1 broker work (#397): `broker.send`
  accepts `onTurn: ((turn: BrokerTurn) => void) | null` and fires it **synchronously, once per
  assistant turn, in arrival order**, before `send()` resolves (see
  `broker-send-on-turn-callback.md`). `BrokerTurn = { index, role, content, hash, timestamp }`.
- Single-package change: `@united-workforce/cli` only (`packages/cli/src/commands/broker-step.ts`
  + `packages/cli/src/store.ts`). No broker, protocol, or Sumeru changes.
- Current (pre-#398) anchors in `packages/cli/src/commands/broker-step.ts`:
  - The primary send (currently lines ~502–508) passes `onTurn: null`:
    ```typescript
    const primary = await broker.send({ threadId, role, prompt: assembledPrompt, onTurn: null });
    ```
  - `TURN_SCHEMA` (lines ~56–65) is `{ role: enum["assistant","tool"], content: string }`,
    `additionalProperties: false`.
  - `executeBrokerStep` already holds `args.uwf` (an `UwfStore`), `args.threadId`, and `args.role`.
- ocas `VarStore` contract (source of truth `~/repos/ocas/packages/core/src/types.ts`):
  a `Variable` binds `(name, schema) → value: Hash` — **a single CAS hash, not an inline array**.
  So an ordered list of turn hashes is stored as its **own CAS node** (e.g. a JSON array node),
  and the active var's `value` is the hash of that node. "Append" is therefore a **read-modify-write**:
  read the var → `cas.get` the current array node → push the new turn hash → `cas.put` the new
  array node → `var.set`/`var.update` the var to the new node hash. (RFC: "append turnHash 到
  active var ...（SQLite，读-改-写数组）".)
- A new active-var namespace is introduced under the existing `@uwf/*` convention
  (`store.ts` already defines `REGISTRY_VAR_PREFIX`/`THREAD_VAR_PREFIX`):
  `@uwf/active-turns/<threadId>/<role>` — the mutable head pointer for the in-flight step's turn list.

## When
- A unit test (named/`describe`d so it matches `-t "active-turns"`) drives `executeBrokerStep`
  (`packages/cli/src/commands/broker-step.ts`) against a **mock broker / Sumeru SSE stub** whose
  stream emits exactly **3 assistant `turn` frames** (distinct non-empty `content`, e.g.
  `"t1"`, `"t2"`, `"t3"`), then a `done` frame — so `onTurn` fires 3 times.
- The test observes the active var after each callback, e.g. via
  `uwf.varStore.list({ exactName: "@uwf/active-turns/<tid>/<role>" })` and by resolving the
  pointed-at array node through `uwf.store.cas.get(...)`.
- Verification command (issue #398, Step 1):
  ```bash
  cd ~/repos/united-workforce && npx vitest run packages/cli -t "active-turns" 2>&1 | tail -20
  ```

## Then
- For each arriving assistant turn, the `onTurn` callback wired by broker-step does, in order:
  - **(a)** `uwf.store.cas.put(<turnSchemaHash>, { role: "assistant", content: turn.content })`
    → a `turnHash`. The turn node is the **pure `{role, content}`** shape validating against the
    existing `TURN_SCHEMA` (RFC appendix A: turn nodes stay pure content; linkage lives in the var).
    `role` is `"assistant"` because Phase 1 only fires `onTurn` for assistant turns.
  - **(b)** read-modify-write appends `turnHash` to the array node pointed at by
    `@uwf/active-turns/<tid>/<role>`, then re-points the var at the new array node.
- After the i-th callback (i = 1, 2, 3), resolving `@uwf/active-turns/<tid>/<role>` yields an
  **ordered array of exactly i turn hashes** — the length grows **1 → 2 → 3**, monotonically,
  one per callback, in arrival order.
- `uwf.varStore.list({ exactName: "@uwf/active-turns/<tid>/<role>" })` returns **exactly one**
  `Variable` for that name (it is a single mutable pointer, re-pointed on each append — not one
  var per turn).
- Each element hash in the resolved array is gettable in CAS: `uwf.store.cas.get(<turnHash>)`
  returns a node whose payload is `{ role: "assistant", content: <the i-th SSE content> }`,
  with `content` matching the SSE event **byte-for-byte** (no trimming / re-parse).
- The appended `turnHash` is **uwf's own CAS hash** of `{role, content}` (computed via
  `TURN_SCHEMA`); it need not equal `BrokerTurn.hash` (the Sumeru-computed hash), which is not
  persisted into the uwf turn node.
- Final ordering matches arrival: resolving the var after all 3 callbacks gives
  `[hash(t1), hash(t2), hash(t3)]` whose contents are `["t1", "t2", "t3"]`.

## Notes
- The realtime guarantee is inherited from Phase 1: because `onTurn` fires synchronously inside
  `consumeSse` before `send()` resolves, the active var reaches length 3 **before**
  `executeBrokerStep` returns — this is what later enables cross-process visibility
  (`cli-broker-step-cross-process-visibility.md`) and crash resilience.
- Frontmatter retries within the **same** `executeBrokerStep` call (`broker.send` re-sent on the
  cached session) also carry `onTurn` and therefore **continue appending** to the same active var
  — the var is cleared only at the **start of a step** (a fresh attempt), never between retries.
  See `cli-broker-step-crash-rerun-clears-active-var.md`.
- The exact CAS schema of the array node (e.g. a bare `ocas_ref[]` array vs. a small wrapper
  object) is an implementation choice; the asserted contract is the **observable**: one var,
  resolving to an ordered list of N gettable `{role,content}` turn nodes that grows by one per
  callback.
