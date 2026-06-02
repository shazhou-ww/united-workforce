# RFC: Merkle Call Stack — Cross-Thread DAG Linking

**Author:** 小橘 🍊（NEKO Team）
**Date:** 2026-05-11
**Status:** Draft

## Problem

当 `workflowAsAgent` 在父 workflow 中 spawn 子 workflow 时，父子 thread 之间没有任何 Merkle 链接：

1. **子 thread 不知道自己从哪来** — start node 只有 prompt hash，无法追溯父 thread 的上下文（preparer 分析出的 repoPath、conventions 等）
2. **父 thread 不知道子 thread 在哪** — developer role 的 state node 里只有 agent 返回的文本，child thread root hash 埋在字符串里，不是结构化 ref
3. **上下文传递靠序列化到 prompt** — 父 workflow 前置 role 的产出只能通过拼字符串传给子 workflow，丢失了 Merkle DAG 的可遍历性

## Proposal

在 CAS 节点中建立父子 thread 之间的 **双向 Merkle 链接**，形成调用栈结构。

### 新增字段

#### StartNodePayload（子 → 父）

```typescript
type StartNodePayload = {
  name: string;
  hash: string;
  depth: number;
  parentState: string | null;   // NEW: 父 thread 调用时的 head state hash
};
```

`parentState` 指向子 workflow 被 spawn 时，父 thread 的最后一个 state node hash。这是"调用发生时的调用栈帧"。

#### StateNodePayload（父 → 子）

```typescript
type StateNodePayload = {
  role: string;
  meta: Record<string, unknown>;
  start: string;
  content: string;
  ancestors: string[];
  compact: string | null;
  timestamp: number;
  childThread: string | null;   // NEW: 子 thread 最终 state hash（执行结果）
};
```

`childThread` 指向子 thread 完成后的**最终 state hash**（不是 start）——语义上是"函数返回值"，从这里沿 ancestors 可回溯子 thread 的完整执行历史。

### refs 同步

新增的 hash 也必须放进 `refs[]`：

- `StartNode.refs`: `[promptHash, parentState]`（parentState 非 null 时）
- `StateNode.refs`: `[...existingRefs, childThread]`（childThread 非 null 时）

原因：GC 的 `findReachableHashes` 只走 `refs`，不解析 payload 字段。字段提供语义，refs 保证可达性。

### 具体 DAG 结构

以 `solve-issue`（fix #191）为例，developer role 委托给 `develop` 子 workflow：

```
父 thread: solve-issue
═══════════════════════════════════════════════════════════

content("fix #191")
  hash: ABCD1234

start(solve-issue)
  hash: START001
  payload: { name: "solve-issue", hash: BUNDLE_SI, depth: 0, parentState: null }
  refs: [ABCD1234]

state(preparer)
  hash: STATE_P1
  payload: { role: "preparer", meta: { repoPath: "...", ... }, childThread: null, ... }
  refs: [PREP_CONTENT]

state(developer)                          ──────── 父→子 ────────
  hash: STATE_D1                                                 │
  payload: { role: "developer", meta: { ... }, childThread: ★CSTATE_END, ... }
  refs: [DEV_CONTENT, ★CSTATE_END]                               │
                                                                  │
state(submitter)                                                  │
  hash: STATE_S1                                                  │
  payload: { role: "submitter", ..., childThread: null }          │
                                                                  │
                                                                  │
子 thread: develop                                                │
═══════════════════════════════════════════════════════════        │
                                                                  │
content("fix #191")          (CAS 去重，可能同 ABCD1234)           │
  hash: CPROMPT1                                                  │
                              ──────── 子→父 ────────             │
start(develop)                          │                         │
  hash: CHILD_START                     │                         │
  payload: { name: "develop", hash: BUNDLE_DEV, depth: 1,        │
             parentState: ★STATE_P1 }   │                         │
  refs: [CPROMPT1, ★STATE_P1]          │                         │
                                        │                         │
state(planner)                          │                         │
  hash: CSTATE_1                        │                         │
  ...                                   │                         │
                                        │                         │
state(coder)                            │                         │
  hash: CSTATE_2                        │                         │
  ...                                   │                         │
                                        │                         │
state(reviewer) → state(tester) → state(committer)                │
                                        │                         │
  hash: ★CSTATE_END  ◄─────────────────┼─────────────────────────┘
```

### 遍历路径

**子 thread agent 获取父上下文（上行）：**
```
当前 step → start(CHILD_START)
  → refs[1] = STATE_P1（父 preparer 的 state）
    → payload.meta.repoPath = "/home/.../workflow"
    → refs → PREP_CONTENT（完整 preparer 输出）
    → payload.start = START001（父的 start node）
      → refs[0] = ABCD1234（原始 prompt）
```

**从父 thread 追踪子 thread 执行（下行）：**
```
STATE_D1（父 developer state）
  → payload.childThread = CSTATE_END
    → 子 thread 最终 state
    → 沿 ancestors 回溯：committer → tester → reviewer → coder → planner
    → payload.start = CHILD_START（子 thread 入口）
```

**完整调用栈还原：**
```
任意节点 → 沿 start 找到所属 thread 的 StartNode
  → parentState 非 null？沿 parentState 进入父 thread
  → 递归直到 parentState = null（顶层 workflow）
```

## Implementation Plan

### Phase 1: Protocol + CAS 层

1. `protocol/src/cas-types.ts` — `StartNodePayload` 加 `parentState: string | null`，`StateNodePayload` 加 `childThread: string | null`
2. `workflow-cas/src/nodes.ts` — `putStartNode` 接受可选 `parentStateHash`，放入 refs；`putStateNode` 接受可选 `childThreadHash`，放入 refs
3. `workflow-cas/src/nodes.ts` — 解析逻辑兼容新字段（缺失时视为 null）

### Phase 2: Engine 层

4. `workflow-execute/src/engine/engine.ts` — `executeThread` 接受 `parentStateHash: string | null`，传给 `putStartNode`
5. `workflow-execute/src/workflow-as-agent.ts` — spawn 子 thread 时传入父 thread 当前 head state hash 作为 `parentStateHash`；子 thread 完成后返回最终 state hash
6. Engine 写 developer role 的 state node 时，把子 thread 最终 hash 写入 `childThread` 字段

### Phase 3: Agent 可观测性

7. Agent prompt 构建（`buildAgentPrompt`）— 当 start node 有 `parentState` 时，提示 agent 可通过 `cas get` 遍历父上下文
8. CLI `thread show` — 显示 parentState / childThread 链接关系

### Phase 4: 验证

9. 已有测试适配新字段（向后兼容，旧节点 parentState/childThread 为 null）
10. 新增集成测试：workflowAsAgent 场景下验证双向链接正确写入

## Design Decisions

### 为什么 childThread 指向 end 而不是 start？

- 语义是"函数返回值"——父 role 执行完才产出 state，此时子 thread 已跑完
- 从 end 沿 ancestors 可回溯到 start；反过来 start 写入时子 thread 还没跑完，无法知道 end

### 为什么 parentState 指向 state 而不是 start？

- 指向父 thread 调用点的**前一个 state**（即调用发生时的 head）
- 这是子 workflow 能看到的父上下文的"切面"——所有已完成的前置 role 都可达
- 如果是第一个 role 就 spawn 子 workflow（没有前置 state），parentState 指向父的 start node

### 为什么同时放字段和 refs？

- `refs[]` 服务于 GC（`findReachableHashes` 只遍历 refs）和通用 DAG 遍历
- `payload.parentState` / `payload.childThread` 服务于语义读取（明确知道哪个 ref 是什么）
- 不改 GC 逻辑，只加字段，GC 自然正确

### 向后兼容

- 新字段默认 `null`，旧节点解析时缺失字段视为 `null`
- 不影响已有 thread 的遍历和 GC
- `depth` 可通过沿 parentState 链上溯来交叉验证（数据自证）

## Open Questions

1. **多子 thread** — 如果一个 role 需要 spawn 多个子 workflow（目前不存在这个场景），`childThread` 应该改成 `childThreads: string[]` 还是保持单个？
2. **Agent prompt 注入深度** — 子 workflow 的 agent 应该自动遍历多少层父上下文？全部还是限制深度？
3. **CLI 展示** — `thread show` 要不要递归展示整个调用栈，还是只显示直接链接？
