---
"@united-workforce/cli": minor
"@united-workforce/util": patch
---

feat(cli): `uwf step turns <thread-id> [--role <r>] [--live]` consumer command (#400)

RFC 实时 turn 持久化的 Phase 4（消费端）。新增 `uwf step turns` 子命令，在 turn 层
（layer 4）提供查询能力，依赖 Phase 2（#398）落地的 active-turns var API 与 step
完成时固化的不可变 `detail.turns`。

- 读取顺序：active var 优先（运行中 step 的实时 turn 列表
  `@uwf/active-turns/<threadId>/<role>`）→ 回退到 thread head StepNode 的不可变
  `detail.turns`（step 已完成）。两个来源都是 `{role, content}` turn 节点的
  `CasRef[]`，因此复用 `step read` 的渲染管线（`loadTurnData` → `formatTurnBody`），
  per-turn 块逐字节一致。
- `--role` 选择 `(threadId, role)` var；并发角色互不干扰（exact-name 匹配）。省略时
  默认取 head step 的角色，让 `uwf step turns <tid>` 对单角色在途线程“做显然的事”。
- `--live` 轮询 SQLite-backed active var（非 SSE），每个新 turn 仅打印一次（按已发出
  块数渲染增量尾部），step 完成（active var 被固化删除且 thread 不再 running）时退出 0；
  退出前对账 `detail.turns`，保证 active→detail 交接期间不丢 turn。
- 完成态 `detail.turns` 回退是 **role-aware** 的：仅当 thread head StepNode 的
  `role === ` 查询角色时才用其 `detail.turns`，否则返回 `[]`。多角色线程
  （如 `planner → coder`，head 为 coder step）查 `--role planner` / `--role reviewer`
  不再续吐 coder head step 的 turns；`--live` 多 step run（`exec --count N≥2`）退出对账
  走同一 role-aware helper，`--live --role coder` follower 永不把最终 step（如 reviewer）
  的 turns 当作 coder turns 续吐。
- README / cli README / `skill cli` / `prompt usage` 参考文档更新，说明 turn 层查询能力。

`@united-workforce/cli`：minor — 新增 `uwf step turns --live` 消费命令。
`@united-workforce/util`：patch — 重新生成的 CLI/usage 参考文本
（`cli-reference.ts`、`usage-reference.ts`）现包含 `uwf step turns` 条目，随 util release 发布。
只读命令，不改 broker / protocol / Sumeru。
