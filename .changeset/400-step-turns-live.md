---
"@united-workforce/cli": minor
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
- README / cli README / `skill cli` / `prompt usage` 参考文档更新，说明 turn 层查询能力。

单包改动（cli-only），只读命令，不改 broker / protocol / Sumeru。
