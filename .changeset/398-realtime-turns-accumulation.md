---
"@united-workforce/cli": minor
---

feat(cli): realtime per-turn accumulation + step-completion solidification (#398)

RFC 实时 turn 持久化的 Phase 2（本体）。broker-step 在 `broker.send` 时传入
`onTurn` 回调，把每个 assistant turn 实时持久化进 OCAS——既能跨进程查到运行中
step 的中间 turn，step 完成后再固化进不可变 step detail。

- broker-step 调 `broker.send({onTurn})`，回调里：(a) `store.cas.put(TURN_SCHEMA,
  {role,content})` → turnHash；(b) append turnHash 到 active var
  `@uwf/active-turns/<threadId>/<role>`（读-改-写数组）
- step 开始先清空该 active var——crash 重跑是新 attempt，旧 turn 属于失败 attempt，
  不接续 append
- step 完成时 `storeBrokerDetail` 读 active var 全量 turnHash 列表写进 `detail.turns`，
  然后删除 active var；`detail.turnCount = turns.length`（不再恒为 1）
- store.ts 新增 active-turns var 读写 API（`appendActiveTurn` / `readActiveTurns` /
  `clearActiveTurns` / `activeTurnsVarName` / `ACTIVE_TURNS_VAR_PREFIX`）

依赖 Phase 1（#397，broker `onTurn` / `SendResult.turns`）。
