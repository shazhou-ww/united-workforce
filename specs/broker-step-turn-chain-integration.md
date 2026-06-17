---
scenario: "Step execution integrates real-time turn persistence with step-start/step-complete"
feature: broker-step
tags: [broker-step, integration, turn-chain, phase2]
---

## Given

- An in-memory UwfStore with Phase 2 schemas registered
- A thread with ID `tid_test`, StartNode at `<start_ref>`, and one prior completed step
- The prior step has:
  - step-start `SS0` with turns T0, T1
  - step-complete pointing to SS0
  - turn chain head at T1
- A mock broker configured to return 2 turns

## When

- Call `executeBrokerStep` with:
  - `threadId: "tid_test"`
  - `role: "reviewer"`
  - `edgePrompt: "Review the implementation"`
  - `startHash: <start_ref>`
  - `prevHash: <SS0>` (previous step-start, not step-complete)

## Then

**Step-start is written first:**
1. New step-start `SS1` written:
   - `role: "reviewer"`
   - `edgePrompt: "Review the implementation"`
   - `stepIndex: 1`
   - `prev: <SS0>` (links to prior step-start, forming step chain)
   - `startedAtMs: <timestamp>`
2. `@uwf/active-step/<tid_test>` set to `<SS1>`

**Turns arrive and are persisted in real-time:**
3. Turn T2 arrives:
   - Written to CAS: `{ role: "assistant", content: "...", prev: <T1>, owner: <SS1> }`
   - `@uwf/active-turn-head/<tid_test>` updated to `<T2>`
4. Turn T3 arrives:
   - Written to CAS: `{ role: "assistant", content: "...", prev: <T2>, owner: <SS1> }`
   - `@uwf/active-turn-head/<tid_test>` updated to `<T3>`

**Step-complete is written last:**
5. Broker returns with final output
6. step-complete `SC1` written:
   - `startRef: <SS1>`
   - `output: <extracted output>`
   - `detail: <detail node>` (no turns array, just metadata)
   - `completedAtMs: <timestamp>`
7. `@uwf/active-step/<tid_test>` cleared

**Final state:**
- Step chain: SS1 → SS0 (via prev)
- Turn chain: T3 → T2 → T1 → T0 (via prev)
- T2, T3 have `owner: <SS1>`
- T0, T1 have `owner: <SS0>`
- `turnsOfStep(T3, SS1)` returns [T2, T3]
- `turnsOfStep(T3, SS0)` returns [T0, T1]
