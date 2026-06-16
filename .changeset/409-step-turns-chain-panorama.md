---
"@united-workforce/cli": minor
"@united-workforce/util": patch
---

fix(cli): `uwf step turns` renders the whole-thread turn panorama + `--limit`/`--offset` (#409)

`uwf step turns <thread-id>` 由「只读 thread head 那个 step 的 turns」改为
「thread 到目前为止所有 turn 的全景」。底层根因修复：旧实现经
`resolveTurnHashes → readHeadDetailTurns(uwf, head, role)` 只读 head step 的
`detail.turns`，多 step thread（head 为某个角色，如 committer）下查
`--role developer` 因 head-role≠developer 返回空（#408 修 role 隔离的副作用）。

新语义沿整条 chain 遍历每个 step（复用 `cmdStepList` 已有的 `walkChain` +
`collectOrderedSteps`，不重造），逐 turn 标注 role/step：

- 已完成 step 读各自固化的不可变 `detail.turns`，step 级标记 `✓`；
- 进行中 step 读 `@uwf/active-turns/<tid>/<role>` var，step 级标记 `🔄 进行中`；
- per-turn 块复用 `step read` 的 `loadTurnData → formatTurnBody` 管线，逐字节一致；
- **默认全量不截断**（复用 OCAS `ListOptions`「limit: undefined = 无限制」约定），
  新增 `--limit <n>` / `--offset <m>` 在展平的跨 step turn 序列上分页；
- `--role <r>` 改为「沿全 chain 过滤该角色的 step」，先过滤再分页；同角色多 step 聚合；
- `--live` 跟住进行中 step、增量去重打印，退出对账按 **followed role 的 chain step**
  作用域（多 step run 下永不把后续角色的 turns 当作被跟随 step 的续吐）。

role 隔离问题随之结构性消失——turns 始终按其所属 step/role 取源，head-only 的
`readHeadDetailTurns` role-guard hack（#408）不再需要，已移除。

`@united-workforce/cli`: minor — `step turns` 全景语义 + `--limit`/`--offset`
（向后兼容的命令面新增）。
`@united-workforce/util`: patch — 重新生成的 CLI/usage 参考文本
（`cli-reference.ts`、`usage-reference.ts`）现含 `--limit`/`--offset` 与全景说明。

Closes #409.
