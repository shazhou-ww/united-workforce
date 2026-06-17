# RFC: Turn Chain — step-start + owner 分段结构 (#412)

**状态**: 设计已拍，待实现
**作者**: 小橘 🍊（NEKO Team）
**关联**: #412（同名 role in-flight 误标）、RFC 实时 Turn 持久化（#395，已交付）

---

## 背景

`uwf step turns`（#409）把整个 thread 的 turn 按 step 分段铺成全景。但当前 turn 的"归属"是靠 `(threadId, role)` 反推的，**粒度比 step 粗**——同一个 role 在一个 thread 里可以跑多轮（workflow 有环，如 `developer → reviewer → developer`），`(threadId, role)` 无法区分是第几轮。

### 病根：粒度错配

turn 的身份维度是 `(thread, role)`，但 step 比它细：同一个 `(thread, role)` 能对应多个 step（多轮）。

具体到 #412：当 `developer 第2轮` 正在跑（active var `@uwf/active-turns/<thread>/developer` 存在）时，`buildTurnsPanorama` 遍历到**第1轮已完成的 developer step**，会按 role 把第2轮的 active var 错贴给第1轮 step。后果：
- 第1轮的 `detail.turns` 被丢
- 第1轮 completed step 被误标「🔄 进行中」
- 第2轮 in-flight 组错位

### 已钉死的代码事实

- **StepNode 已是不可变链表**：`StepNodePayload = StepRecord + { start, prev: CasRef | null }`（`protocol/src/types.ts:105`）。`walkChain` 遍历它。
- **edgePrompt 已落盘**：`StepRecord.edgePrompt`（`types.ts:16`）每个 StepNode 都带，`buildTurnsPanorama` 直接可读。
- **turn 节点极简**：当前 `{ role:"assistant", content }`（`broker-step.ts:380`），无 prev、无 owner。
- **turn 顺序靠数组**：active var 存 turnHash 数组（`store.ts:122 appendActiveTurn` 读-改-写数组），detail.turns 也是数组。顺序是数组序，不是链表指针。
- **active var 按 role 分键**：`@uwf/active-turns/<threadId>/<role>`（`store.ts:49`）。**这是歧义的物理源头。**
- **StepNode 完成才写**：output/detail/completedAtMs 要等 agent 返回才有，所以 StepNode 是 step 结束时固化的——turn 实时产生时，它所属的 StepNode 还不存在。
- **CAS 不可变**：节点一旦 put，hash 固定。不能"预写再回填"——回填会改 hash，引用失效。

### 设计决策（主人已拍）

1. **var 维持 thread 维度，role 维度内化进 step-start** —— 不为展示粒度去拆 var 的 role 键。
2. **引入 step-start**：把现在"完成才写"的 StepNode 一分为二——step **开跑时**立刻写 step-start（含 step 开始时已知的全部信息：role、edgePrompt、stepIndex、prev、startedAtMs、cwd），step **完成时**写 step-complete（output、detail、completedAtMs、usage），指回 step-start。
3. **三条独立结构，各单一职责**：
   - **turn chain**：turn 之间 `prev` 串成全局连续链（跨 step 一条到底）
   - **step chain**：step-start 之间 `prev` 串链（即现有 StepNode 链的演进）
   - **owner**：每个 turn 带 `owner → step-start 的 hash`，O(1) 定位归属
4. **owner 存 step-start 的 hash**（不是 stepIndex）。stepIndex 降级为 step-start 的一个属性（用于展示/排序），**身份是 hash**。
5. **active var 存 head ref，不存数组**：
   - `@uwf/active-turn-head/<thread>` → turn chain 链尾 hash（顺序靠 turn.prev 表达）
   - `@uwf/active-step/<thread>` → 当前在跑的 step-start hash
   - **均为 thread 维度，不再按 role 分键** —— #412 的歧义源头物理消失。
6. **turn 不再固化进 detail.turns**：turn 靠 prev 链 + owner 已自包含（self-contained）。detail 不再冗余存 turn 列表。
7. **sumeru 暂不改**：step/owner 是 workflow 编排层（uwf）的概念，sumeru 只是 agent 收发室，继续吐线性 turn、维持 `turnHashes` 数组。uwf 在 broker-step 的 onTurn 里给每个 turn 套上 prev+owner 存进自己的 CAS。**职责不串味。**

### 为什么这个模型对（vs. 哨兵节点方案）

早期设想是"turn 链里插 step-start 哨兵当分隔符"。三条链分解后**不需要哨兵**：分段不靠插入分隔符，靠 owner 反查（"owner == stepX 的所有 turn"）。step 边界是**算出来的**，不是**插出来的**。这同时消解了"哨兵指向尚未生成的 StepNode"的占位/回填难题。

### 核心数据流

```
step 开跑:
  1. 写 step-start node { role, edgePrompt, stepIndex, prev→上个step-start,
                          startedAtMs, cwd } → 得 hash SS2
  2. active var @uwf/active-step/<thread> → SS2

turn 实时到达 (onTurn):
  3. 写 turn { role:"assistant", content, prev→上个turn hash, owner→SS2 } → 得 hash T5
  4. active var @uwf/active-turn-head/<thread> → T5   (链尾前移)

step 完成:
  5. 写 step-complete { startRef→SS2, output, detail, completedAtMs, usage }
  6. 推进 thread head
  (turn 不动！已靠 prev 链 + owner 各就各位，无需固化进 detail)
```

回溯示意：

```
turn chain:  turn5 ─prev→ turn4 ─prev→ turn3 ─prev→ turn2 ─prev→ turn1 ─prev→ turn0
step chain:  SS2 ─prev→ SS1 ─prev→ SS0
owner:   turn5,turn4 ─owner→ SS2 ; turn3,turn2 ─owner→ SS1 ; turn1,turn0 ─owner→ SS0
```

---

## Phase 拆分

串行三个 Phase（NEKO-VM 防 OOM）：① 存储层结构 → ② producer 改造 → ③ consumer 分段重写。

### Phase 1: step-start + turn chain 存储层（地基）

**改动范围**: `@united-workforce/protocol`（类型 + schema）、`@united-workforce/cli` store

**依赖**: 无

**用户视角验证目标**: 新结构的节点能写入 CAS 并往返——step-start 带 role/edgePrompt/stepIndex/prev；turn 带 content/prev/owner；三条链（turn prev、step prev、owner）可遍历。纯结构层，不接 broker。

**实现要点**:
- protocol 新增类型：
  - `StepStartPayload = { role, edgePrompt, stepIndex, prev: CasRef | null, start: CasRef, startedAtMs, cwd }`
  - `StepCompletePayload = { startRef: CasRef, output, detail, completedAtMs, usage, previousAttempts }`（承接现 StepRecord 里"完成才有"的部分）
  - turn node 扩展：`{ role, content, prev: CasRef | null, owner: CasRef }`
- 对应 JSON schema（`protocol/src/schemas.ts`），含 legacy 兼容（旧 turn 无 prev/owner → null）
- store 新增纯函数（不接 broker，可单测）：
  - `writeStepStart(store, payload) → hash`
  - `writeTurnNode(store, { content, prev, owner }) → hash`
  - `walkTurnChain(store, headHash) → CasRef[]`（沿 prev 回溯，返回顺序数组）
  - `turnsOfStep(store, turnHeadHash, stepStartHash) → CasRef[]`（owner == stepStartHash 的 turn）
- **决策：保留 `StepNodePayload` 作为 legacy 读路径**，新写走 step-start/step-complete 双节点。`walkChain` 兼容两种。

**交付标准（可验证）**:
- [ ] **单测：step-start 往返**
  ```bash
  cd ~/repos/united-workforce && npx vitest run packages/cli -t "step-start" 2>&1 | tail -20
  ```
  预期：写 3 个 step-start（prev 串链）→ 沿 prev 遍历得 3 个，stepIndex 0/1/2，edgePrompt 各就位。
- [ ] **单测：turn chain prev 遍历**
  预期：写 6 个 turn（prev 串链）→ `walkTurnChain(head)` 返回 6 个，顺序正确。
- [ ] **单测：owner 分段**
  预期：6 turn 分属 3 step-start（2/2/2）→ `turnsOfStep(head, SS1)` 只返回 owner==SS1 的 2 个，不含其他 step 的 turn。
- [ ] **单测：legacy 兼容**
  预期：旧 turn 节点（无 prev/owner）能读，不 crash。
- [ ] **CI 绿** + **changeset**（`@united-workforce/protocol: minor`、`@united-workforce/cli: minor`）

---

### Phase 2: broker-step producer 改造 + active var 转 thread 级（本体）

**改动范围**: `@united-workforce/cli` broker-step + store

**依赖**: Phase 1

**用户视角验证目标**: 真实跑一个 step，turn 实时带 prev+owner 落 CAS；step 开跑写 step-start、完成写 step-complete；active var 是 thread 级 head 指针，**同 role 多轮各自归属正确**（#412 根除）。

**实现要点**:
- step 开跑：先 `writeStepStart`（拿 edgePrompt/stepIndex/prev），active var `@uwf/active-step/<thread>` → SS hash
- `makeOnTurn` 改造：每个 turn 写 `{ role:"assistant", content, prev→上个turn head, owner→当前SS }`，再把 `@uwf/active-turn-head/<thread>` 前移到新 turn
- step 完成：`writeStepComplete`（指回 SS），**不再** `storeBrokerDetail` 固化 turn 进 detail（turn 已自包含）
- **active var 全转 thread 维度**：`@uwf/active-step/<thread>`、`@uwf/active-turn-head/<thread>`，废弃 `@uwf/active-turns/<thread>/<role>`
- crash 重跑：新 attempt 写新 step-start（新 hash），旧 attempt 的 turn owner 指旧 SS，**天然隔离**，不接续
- 移除 `appendActiveTurn`/`readActiveTurns`/`clearActiveTurns` 的 role 参数路径

**交付标准（可验证）**:
- [ ] **单测：onTurn 写 prev+owner**
  预期：mock broker 发 3 turn → 每个 turn 节点 owner == 当前 step-start hash，prev 串成链，active-turn-head 指最后一个。
- [ ] **单测：step-start/step-complete 双节点**
  预期：step 开跑后 active-step 指向新 SS；完成后 step-complete.startRef == SS，thread head 推进。
- [ ] **单测：#412 回归——同 role 多轮归属**（核心）
  预期：seed `developer(轮1完成) → reviewer → developer(轮2 in-flight)`；轮1 turn owner==SS_dev1，轮2 turn owner==SS_dev3；**轮1 step 不被标 in-flight，轮2 turn 不贴到轮1**。
- [ ] **集成验证：真实 thread 跨进程可见**
  ```bash
  # 终端A：起慢 step
  uwf thread exec <tid> --count 1 &
  # 终端B：查当前 active-turn-head 链
  sqlite3 ~/.ocas/vars/_store.db "SELECT value FROM vars WHERE name='@uwf/active-turn-head/<tid>'"
  ```
  预期：step 未完成时即可沿 head 回溯到已产生的 turn，数量随时间增长。
- [ ] **CI 绿** + **changeset**（`@united-workforce/cli: minor`）

---

### Phase 3: buildTurnsPanorama 按 owner 分段重写（消费端）

**改动范围**: `@united-workforce/cli` commands/step

**依赖**: Phase 2

**用户视角验证目标**: `uwf step turns <thread>` 全景按 owner 分段，同 role 多轮各段独立、顺序正确、in-flight step 正确标「🔄 进行中」、edge prompt 可展示。#409 既有能力（全 chain、分页、--role、--live）全部保持。

**实现要点**:
- `buildTurnsPanorama` 重写：从「按 role 查 active var」改为
  - 沿 step chain（step-start prev）遍历每个 step
  - 每段 turn = `turnsOfStep(turnHead, 该step-start)`（owner 反查）
  - in-flight 判定：step-start 有对应 active-step 且无 step-complete → 标「🔄 进行中」
  - edge prompt：直接读 step-start.edgePrompt
- `--role` 过滤：按 step-start.role 筛段（同 role 多段全保留，#409 语义不变）
- `--live`：跟住 active-turn-head 增长
- 分页：在展平的 turn 序列上 limit/offset（#409 语义不变）

**交付标准（可验证）**:
- [ ] **单测：按 owner 分段全景**
  预期：3 step（含同 role 多轮）→ 每段 turn 来自各自 owner，不串段。
- [ ] **单测：#412 端到端**
  预期：`developer→reviewer→developer(in-flight)` 全景：轮1 developer 段标 ✓、轮2 developer 段标 🔄 进行中，两段 turn 不混。
- [ ] **单测：#409 既有能力回归**
  预期：全 chain、`--limit/--offset`、`--role`、`--live` 全部行为不变（复用 #409 测试集 + 新结构）。
- [ ] **集成验证：真实多 step thread**
  ```bash
  uwf step turns <真实thread> --role developer
  ```
  预期：能查到 developer 各轮 turn，edge prompt 可见，in-flight 段正确标记。
- [ ] **CI 绿** + **changeset**（`@united-workforce/cli: minor`）

---

## 完成标准（RFC 级）

- [ ] #412 根除：同 role 多轮 + 最新轮 in-flight 时，`step turns` 各段归属/标记/顺序全部正确
- [ ] turn 自包含：turn 靠 prev 链 + owner 表达顺序与归属，不依赖 detail.turns 固化
- [ ] active var 全 thread 维度，无 role 分键
- [ ] #409 既有能力（全 chain、分页、--role、--live）零回归
- [ ] step-start 携带 edgePrompt，全景可展示「这一段因何被触发」
- [ ] 三个包发版（protocol、cli）

---

## Legacy 退出计划

| 阶段 | 时间点 | 动作 |
|------|--------|------|
| Phase 3 完成 | 本 RFC 交付 | **新写全走 step-start/step-complete 双节点**，`StepNodePayload` 降为只读 |
| 下一个 minor | Phase 3 后首次 minor 发版 | 移除 legacy 写路径代码 |
| 归档期结束 | Phase 3 + 90 天 | 移除 legacy 读路径（`walkChain` 的 `StepNodePayload` 分支） |

**原则**：legacy 兼容是迁移过渡，不是永久债务。

---

## 未来演进（设计意图，非本 RFC 范围）

uwf 先用这套「turn chain + step-start + owner」做实验田。**稳定后**，把它沉淀为 ocas 中 **agent session 的标准存储结构**，sumeru 等其他 agent 收发层逐步采纳——届时 turn 不再是各家私有的线性数组，而是 ocas 一等的链式可分段结构。uwf 是先行者，不是特例。这也是本 RFC 选择"uwf 侧先行、sumeru 暂不动"的根本原因。

---

## 附录：决策对照（轻→重的取舍）

| 方案 | 改动 | 是否选 |
|------|------|--------|
| X：active var key 加 stepIndex 维度 | 最轻，1 个小 PR，不动结构 | ❌ 只修症状，留半成品 |
| Y：active var 带 step 锚点 hash | 中，集中在 store 层 | ❌ 同上 |
| **Z：step-start + turn chain + owner** | 重，3 Phase，动存储模型 | ✅ **一次做对地基，为 ocas 标准结构铺路** |

主人定调：一次性做好（Z）。理由——X/Y 只解 in-flight 窄窗口的症状，Z 把 step 边界变成数据结构一等公民，且为「ocas agent session 标准存储」这个更大目标打地基。

— 小橘 🍊（NEKO Team）
