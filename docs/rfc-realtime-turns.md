# RFC: 实时 Turn 持久化与进度可见 (#395)

**作者**: 小橘 🍊（NEKO Team）
**状态**: 待主人审阅
**关联**: #395 (discuss), sumeru #32, uwf #391(已修)

---

## 背景

broker 通过 SSE 从 Sumeru 实时收到每个 turn event（CC 读文件、写代码、跑命令），
但 `consumeSse` 只做累积，`finalizeOutcome` 只 `return last.content`——中间几十个
turn 全部丢弃。跑 30 分钟的任务期间完全看不到进度，exec 被杀后不知道做到哪了。

### 已钉死的代码事实

| 位置 | 现状 |
|------|------|
| `broker/sumeru-client.ts:273-281` | `finalizeOutcome` 只取 `assistantTurns[last]`，其余丢弃 |
| `broker/sumeru-client.ts:423-436` | `parseTurnEvent` 已解析出完整 turn（含 Sumeru 算好的 `hash`），数据**收到了**但没往上传 |
| `broker/send/types.ts:42-56` | `SendResult` 只有 `output`/`assistantTurnCount`，无逐 turn 数据 |
| `cli/broker-step.ts:331-351` | `storeBrokerDetail` 封口式：`turns:[turnHash]` 单个 assistant turn |
| `cli/broker-step.ts:503-507` | broker-step 主流程调 `broker.send({threadId,role,prompt})` |
| `sumeru/specs/server-ocas-turn-recording.md` | Sumeru 侧**已**逐 turn put 进自己的 OCAS，但 `Session.turnHashes` 是 in-memory（"lost on restart"） |
| CLI 架构 | `workflow → thread → step → turn` —— turn 是**既定第四层** |

### 设计决策（主人已拍）

1. **A 必做**：Sumeru 侧逐 turn 落盘 + 可查（解决 crash 数据丢失）
2. **B 必做**：SSOT 必须由 uwf 写入 OCAS——因为 Sumeru 可能与 uwf 不在同一设备，
   只在 Sumeru 持久化则断联后访问不到
3. **不重构 step 不可变结构**：用可变 var 存 active step 的 turn 列表头，
   step 完成时再按列表形式固化进 step detail 节点
4. **列表 over 链表**（小橘建议，待确认）：turn 节点保持纯内容 `{role,content}`，
   链接关系外置到 var。理由见附录 A

---

## Phase 拆分

每个 Phase 独立可验证，串行验证、可并行开发。依赖关系：

```
Phase 1 (broker callback) ──┐
                            ├─→ Phase 2 (uwf active var 累积+固化) ──→ Phase 4 (CLI --live)
Phase 3 (Sumeru SQLite) ────┘ (并行，不阻塞)
```

---

### Phase 1: broker 暴露 per-turn callback（地基）

**改动范围**: `@united-workforce/broker` 单包，无 Sumeru 依赖

**用户视角验证目标**: broker.send 的调用方能在每个 turn 到达时**实时**收到回调，
而不是等整个 send 结束。

**实现要点**:
- `SendArgs` 增加 `onTurn: ((turn: BrokerTurn) => void) | null`
- `BrokerTurn` = `{ index, role, content, hash, timestamp }`（hash 来自 Sumeru SSE）
- `consumeSse` 每 apply 一个 turn event 就触发 `onTurn`（同步，在 reader 循环内）
- `SendResult` 增加 `turns: BrokerTurn[]`（全量，向后兼容——`output` 仍是 last）
- callback 为 null 时行为与现在完全一致

**交付标准（可验证）**:
- [ ] **单测：onTurn 被逐次调用**
  ```bash
  cd ~/repos/united-workforce && npx vitest run packages/broker --reporter=verbose 2>&1 | grep -i "onTurn\|per-turn"
  ```
  预期：新增 test 断言 mock SSE 发 N 个 turn event → onTurn 被调用 N 次，
  且每次 callback 收到的 `turn.content` 与 SSE event 内容一致、`turn.hash` 非空。
- [ ] **单测：SendResult.turns 全量**
  断言 `result.turns.length === assistantTurnCount`，且 `result.turns[last].content === result.output`（向后兼容）。
- [ ] **单测：onTurn=null 不破坏现有行为**
  断言已有的 send 测试全绿（`npx vitest run packages/broker` 全通过）。
- [ ] **CI 绿** + **changeset**（`@united-workforce/broker: minor`）

---

### Phase 2: uwf broker-step 实时累积 + step 完成固化（本体）

**改动范围**: `@united-workforce/cli` broker-step + store

**依赖**: Phase 1

**用户视角验证目标**: 一个 step 跑到一半时，**另一个独立进程**能查到已经产生的
中间 turn（而不是只能看到最终输出）；step 完成后这些 turn 固化进不可变 step detail。

**实现要点**:
- broker-step 调 `broker.send` 时传 `onTurn`，回调里：
  - (a) `uwf.store.cas.put(turnSchema, {role,content})` → turnHash
  - (b) append turnHash 到 active var `@uwf/active-turns/<threadId>/<role>`（SQLite，读-改-写数组）
- **step 开始先清空 active var**（crash 重跑是新 attempt，旧 turn 属于失败 attempt，不接续 append）
- step 完成时 `storeBrokerDetail` 改为读 active var 的全量 turnHash 列表写进 `detail.turns`，
  然后**删除** active var（已固化，不再需要可变指针）
- 固化后 `detail.turnCount = turns.length`（不再恒为 1）

**交付标准（可验证）**:
- [ ] **单测：active var 实时增长**
  ```bash
  cd ~/repos/united-workforce && npx vitest run packages/cli -t "active-turns" 2>&1 | tail -20
  ```
  预期：mock broker 发 3 个 turn → 每次回调后 `varStore.list({exactName:"@uwf/active-turns/<tid>/<role>"})`
  的数组长度递增 1→2→3，且每个 hash 在 CAS 里能 get 到对应 `{role,content}`。
- [ ] **单测：step 完成固化 + 清理 active var**
  预期：step 完成后 `detail.turns.length === 3`、`detail.turnCount === 3`，
  且 active var 已删除（`varStore.list(...)` 返回空）。
- [ ] **单测：crash 重跑清空旧 turn**
  预期：seed 一个残留 active var（2 个 turn）→ 重跑 step 发 3 个新 turn →
  最终 detail.turns 只含新的 3 个，不含旧的 2 个。
- [ ] **集成验证：跨进程可见性**（核心用户价值）
  ```bash
  # 终端A：起一个慢 step（mock adapter 每 turn sleep）
  uwf thread exec <tid> --count 1 &
  # 终端B：step 跑到一半时查 active var
  node packages/cli/dist/cli.js step turns <tid> --role coder
  ```
  预期：终端B 在 step 未完成时就能列出已产生的 turn（数量随时间增长）。
  *(注：`step turns` 子命令在 Phase 4 实现；Phase 2 验证阶段可直接查 SQLite var 表)*
- [ ] **CI 绿** + **changeset**（`@united-workforce/cli: minor`）

---

### Phase 3: Sumeru turnHashes 落 SQLite（A 线收尾，可并行）

**改动范围**: `@sumeru/server` Session 存储

**依赖**: 无（独立于 Phase 1/2，可并行开发）

**用户视角验证目标**: Sumeru server 重启后，已记录的 session turn 列表不丢失——
`GET session turns` 在重启前后返回一致。

**实现要点**:
- `Session.turnHashes` 从 in-memory 数组改为持久化（OCAS var 表 / SQLite）
- spec `server-ocas-turn-recording.md` 已定义逐 turn put，只差把列表指针持久化
- turn 内容节点本来就在 OCAS（不可变），只需让列表头也落盘

**交付标准（可验证）**:
- [ ] **单测：turnHashes 持久化往返**
  ```bash
  cd ~/repos/sumeru && pnpm run test 2>&1 | grep -i "turnHashes\|restart\|persist"
  ```
  预期：写入 N 个 turn → 重建 Session 对象（模拟重启）→ turnHashes 仍为 N 个，
  且每个 hash 在 OCAS 里能 get 到。
- [ ] **集成验证：进程级重启**
  ```bash
  # 起 sumeru，发消息产生 turn，记下 GET .../sessions/<id> 的 turn 数
  # kill server，重启，再 GET，turn 数应一致
  curl -s localhost:7900/gateways/<gw>/sessions/<id> | jq '.turnHashes | length'
  ```
  预期：重启前后 turn 数相同（当前实现重启后归零）。
- [ ] **CI 绿** + **changeset**（`@sumeru/server: minor`）

---

### Phase 4: CLI `uwf step turns --live` 消费端

**改动范围**: `@united-workforce/cli` step 子命令

**依赖**: Phase 2

**用户视角验证目标**: 用户在 step 运行期间能用一条 CLI 命令实时查看进度，
不需要手动 curl Sumeru 或翻 worktree。

**实现要点**:
- 新增 `uwf step turns <thread-id> [--role <r>] [--live]`
- 读取顺序：active var（运行中）→ 若无则读 step detail.turns（已完成）
- `--live` 轮询 active var，新 turn 到达时打印（poll SQLite，非 SSE）
- 复用 `step read` 的 markdown 渲染逻辑

**交付标准（可验证）**:
- [ ] **单测：运行中读 active var，完成后读 detail**
  预期：active var 存在时 `step turns` 输出其内容；active var 删除后（step 完成）
  输出 detail.turns 内容；两者对同一 step 应一致。
- [ ] **集成验证：--live 实时刷新**
  ```bash
  uwf thread exec <tid> --count 1 &
  uwf step turns <tid> --role coder --live
  ```
  预期：随 step 推进，新 turn 逐条打印；step 完成后命令退出。
- [ ] **文档**：README/CLI help 更新，说明 turn 层查询能力
- [ ] **CI 绿** + **changeset**（`@united-workforce/cli: minor`）

---

## 完成标准（RFC 级）

- [ ] Phase 1-4 所有 testing issue 已 close
- [ ] 端到端：跑一个真实 solve-issue thread，运行期间 `uwf step turns --live`
      能看到 CC 逐 turn 进度；exec 被 kill 后已产生的 turn 仍可查（不丢失）
- [ ] Sumeru 重启后历史 session turn 不丢失
- [ ] 所有变更已发版（broker / cli / sumeru）

---

## 附录 A：列表 vs 链表

选**列表**（var 存 `hash[]`），不选链表（var 存 head，turn 带 prev）：

| 维度 | 列表 | 链表 |
|------|------|------|
| turn 节点纯度 | `{role,content}` 纯内容，可跨系统去重 | 需加 `prev` 字段，与 Sumeru turn schema 分叉 |
| 与 Sumeru 一致性 | ✅ Sumeru 也是 `turnHashes[]` 数组 | ❌ Sumeru 无 prev 概念 |
| 固化成本 | detail.turns 直接写数组 | 需从 head 遍历反转 |
| append 成本 | 读-改-写整个数组（CC 一个 step 几十~上百 turn，SQLite WAL 无感）| 只写 head 指针 |

结论：CC 单 step turn 数量级小，列表的 append 成本可忽略；
turn 节点纯内容 + 链接外置到 var 才是 CAS 原教旨，且复用 uwf
"可变 var 指针 + 不可变 CAS 节点" 的现有心智模型。

## 附录 B：为什么 A 和 B 都要做

- **A（Sumeru 自持久）**：解决 crash 时 Sumeru 进程内存丢失，是 source 侧兜底
- **B（uwf 写 OCAS = SSOT）**：Sumeru 可能与 uwf 跨设备，断联后 Sumeru 的数据
  访问不到；uwf 的 OCAS 才是复盘 thread、查问题、做优化的唯一可信源
- 两者不重复：A 是 source 侧实时记录，B 是 SSOT 落盘。即使 A 完整，
  B 仍必须做（跨设备可用性）；即使 B 完整，A 仍有价值（Sumeru 侧 crash 兜底）

---

*小橘 🍊（NEKO Team）*
