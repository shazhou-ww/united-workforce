# `wf` — Stateless Workflow CLI

> 将 workflow 引擎降维为无状态单步 CLI。Workflow 是纯数据（CAS 节点），执行是单步原子操作，agent 是可插拔外部命令。

---

## 1. CLI Design

### 1.1 命令总览

```
# thread 组
uwf thread start <workflow> -p <prompt>     # 创建 thread，不执行
uwf thread step  <thread-id> [--agent]      # 单步执行
uwf thread show  <thread-id>                # thread-id → head 查询
uwf thread list  [--all]                    # 列出活跃 threads（--all 含已归档）
uwf thread kill  <thread-id>                # 终结 thread，归档

# workflow 组
uwf workflow put   <file.yaml>              # 注册 workflow（YAML → CAS）
uwf workflow show  <workflow-id>            # 查看 workflow 定义
uwf workflow list                           # 列出已注册 workflows
```

两组对称，各 3-4 个子命令。CAS 操作交给 `json-cas` CLI，不在 `uwf` 中重复。

### 1.2 `uwf thread start`

```bash
uwf thread start <workflow> -p "Fix the login bug described in issue #42"
```

- `<workflow>` — workflow 名或 CAS hash
- `-p` — 用户 prompt（必填）

**输出（JSON to stdout）：**

```jsonc
{
  "workflow": "4KNM2PXR3B1QW",   // workflow CAS hash (XXH64, 13-char Crockford Base32)
  "thread": "01J7K9M2XNPQR5VWBCDF8G3H4T"      // ULID
}
```

**做的事：**
1. 解析 workflow（名字查 registry → CAS hash）
2. 生成 thread ULID
3. 解析系统 config，确定 agent binding
4. 写 StartNode 到 CAS
5. 在 threads 索引中记录链头 → StartNode hash
6. 输出 JSON

### 1.3 `uwf thread step`

```bash
uwf thread step 01J7K9M2XNPQR5VWBCDF8G3H4T
uwf thread step 01J7K9M2XNPQR5VWBCDF8G3H4T --agent "bunx uwf-cursor"
```

**输出（JSON to stdout）：**

```jsonc
{
  "workflow": "4KNM2PXR3B1QW",
  "thread": "01J7K9M2XNPQR5VWBCDF8G3H4T",
  "head": "8FWKR3TN5V1QA",       // 新链头 StepNode 的 CAS hash
  "done": false                    // true = moderator 返回 END，thread 已归档
}
```

`done: true` 时 head 仍然有值（最后一个 StepNode），但 thread 已从 threads.json 移除。
对已结束或不存在的 thread 调用 step 会报错（非 active thread）。

详细信息通过 `uwf thread show <thread-id>` 或 `json-cas get <head>` 查看。

**做的事：**
1. 读链头 → 当前 StepNode（或 StartNode）
2. 收集 thread 历史（遍历链）
3. 调 moderator：评估 JSONata conditions → 得到下一个 role（或 END）
4. 若 END → 归档 thread，输出最后链头，退出
5. 确定 agent command（`--agent` override > thread binding > global default）
6. 调用：`<agent-cmd> <thread-id> <role>`，捕获 stdout 得到新 StepNode hash
7. 更新链头指针
8. 再次调 moderator（基于新 StepNode）判断 done
9. 输出 JSON

### 1.4 `uwf thread show`

```bash
uwf thread show 01J7K9M2XNPQR5VWBCDF8G3H4T
```

**输出（JSON to stdout）：**

```jsonc
{
  "workflow": "4KNM2PXR3B1QW",
  "thread": "01J7K9M2XNPQR5VWBCDF8G3H4T",
  "head": "8FWKR3TN5V1QA",
  "done": false
}
```

纯 thread-id → head 查询。详细内容用 `json-cas get <head>` 或 `json-cas walk <head>` 查看。

### 1.5 Agent CLI 协议

每个 agent 是一个命令，接受 thread-id 和 role 两个参数：

```bash
uwf-hermes <thread-id> <role>
```

**约定：**
- `uwf step` 负责 moderator 决策，将 role 传给 agent CLI
- agent-kit 根据 thread + role 从 CAS 读 systemPrompt / extractPrompt / schema
- agent-kit 组装完整 prompt（role systemPrompt + thread context + user prompt from StartNode）
- agent 执行实际逻辑，agent-kit 负责 extract
- agent 将 StepNode 写入 CAS（含 meta、content、agent ref、prev ref），但**不挪链头指针**
- stdout 输出新 StepNode 的 CAS hash（纯文本，一行）
- 所有配置从环境变量读（LLM model、API key、extractor config）
- exit 0 = 成功，非 0 = 失败

**stdout 输出：**

```
8FWKR3TN5V1QA
```

`uwf step` 拿到这个 hash 后更新链头指针、判断 done。

---

## 2. CAS 结构定义

### 2.1 类型层级

沿用 json-cas 的三层：bootstrap meta-schema → JSON Schema nodes → data nodes。

下面所有 CAS 节点都遵循 `{ type: cas_ref, payload: T, timestamp: number }` 的标准格式。
`cas_ref` 类型的字符串字段在 json-cas 中已内置支持，不需要额外的 `$ref` 包装。

### 2.2 数据节点

#### `Workflow`

Roles 和 moderator 内联在 Workflow 中，只有 outputSchema 独立为 CAS 节点（方便 json-cas 校验）。

```yaml
type: <workflow-schema-hash>
payload:
  name: "solve-issue"
  description: "End-to-end issue resolution"
  roles:
    planner:
      description: "Creates implementation plan"
      systemPrompt: "You are a planning agent..."
      outputSchema: "5GWKR8TN1V3JA"    # cas_ref → JSON Schema 节点（json-cas 内置）
    developer:
      description: "Implements code changes"
      systemPrompt: "You are a developer agent..."
      outputSchema: "8CNWT4KR6D1HV"    # cas_ref → JSON Schema 节点
    reviewer:
      description: "Reviews code changes"
      systemPrompt: "You are a code reviewer..."
      outputSchema: "1VPBG9SM5E7WK"    # cas_ref → JSON Schema 节点
  conditions:
    needsClarification: "$exists(steps[-1].output.needsClarification)"
    notApproved: "steps[-1].output.approved = false"
  graph:
    $START:
      - role: "planner"
        condition: null                  # 无条件（fallback）
    planner:
      - role: "developer"
        condition: "needsClarification"
      - role: "$END"
        condition: null
    developer:
      - role: "reviewer"
        condition: null
    reviewer:
      - role: "developer"
        condition: "notApproved"
      - role: "$END"
        condition: null
```

- `roles` — 内联定义，每个 role 的 `outputSchema` 是独立的 cas_ref（指向 json-cas 内置 JSON Schema 节点）
- `conditions` — `Record<Name, JSONata>`，命名条件，方便画图描述
- `graph` — `Record<Role | "$START", Transition[]>`，每个 Transition = `{ role, condition }`
- `condition` 引用 conditions 中的 key，`null` = fallback
- 按数组顺序求值，第一个匹配的 transition 胜出
- 不含 agent binding — agent 配置在 `~/.uncaged/workflow/config.yaml` 中管理

JSONata 表达式的求值上下文：

```jsonc
{
  "start": {                          // StartNode 信息
    "workflow": "4KNM2PXR3B1QW",
    "prompt": "Fix the login bug..."
  },
  "steps": [                          // 所有已完成 steps，从旧到新
    { "role": "planner", "output": "3FXJM7QS2A9PB", "detail": "...", "agent": "..." },
    { "role": "developer", "output": "8CNWT4KR6D1HV", "detail": "...", "agent": "..." },
    { "role": "reviewer", "output": "1VPBG9SM5E7WK", "detail": "...", "agent": "..." }
  ]
}
```

注：`output` 在上下文中会被自动展开为实际的 CAS 节点内容（而非 hash），方便 JSONata 表达式直接访问字段。

#### `StartNode`（Thread 起点）

```yaml
type: <start-node-schema-hash>
payload:
  workflow: "4KNM2PXR3B1QW"        # cas_ref → Workflow
  prompt: "Fix the login bug..."
```

- 没有 thread-id — thread-id 是索引层面的事，不进 CAS 内容
- 没有 agent binding — 运行时从 config.yaml 解析

#### `StepNode`（Thread 每一步）

```yaml
type: <step-node-schema-hash>
payload:
  start: "4TNVW8KR2B3MA"          # cas_ref → StartNode（每个 step 都引用）
  prev: "2MXBG6PN4A8JR"           # cas_ref → 前一个 StepNode，第一步为 null
  role: "developer"
  output: "9KRVW3TN5F1QA"         # cas_ref → 结构化输出节点（符合 role 的 outputSchema）
  detail: "7BQST3VW9F2MA"         # cas_ref → 执行详情（content node / 子 workflow terminal StepNode / ...）
  agent: "uwf-cursor"              # 实际使用的 agent 命令（纯字符串）
```

- `start` — 每个 StepNode 都直接引用 StartNode，方便随机访问
- `prev` — 前一个 StepNode 的 cas_ref，第一步为 `null`（不指向 StartNode）
- `output` — cas_ref，指向符合 role outputSchema 的 CAS 节点，可用 json-cas 校验
- `detail` — cas_ref，指向执行详情。可以是原始 agent 输出（content node），也可以是子 workflow thread 的 terminal StepNode（workflowAsAgent 场景）
- `agent` — 纯字符串，不是 CAS 节点

### 2.3 链式结构

```
threads.yaml: { "01J7K9M2XNPQR5VWBCDF8G3H4T": "8FWKR3TN5V1QA" }
                                      │
                                      ▼
                              StepNode (step 3)
                              ├── start ──→ StartNode
                              │              ├── workflow → CAS(Workflow)
                              │              └── prompt: "Fix..."
                              ├── prev ──→ StepNode (step 2)
                              │             ├── start ──→ (same StartNode)
                              │             ├── prev ──→ StepNode (step 1)
                              │             │             ├── start ──→ (same StartNode)
                              │             │             ├── prev: null
                              │             │             ├── role: "planner"
                              │             │             └── ...
                              │             ├── role: "developer"
                              │             └── ...
                              ├── role: "reviewer"
                              ├── output → CAS({ approved: true })
                              ├── detail → CAS(raw output | sub-workflow terminal node)
                              └── agent: "uwf-hermes"
```

### 2.4 可变状态

系统两个顶层 YAML 文件：

```yaml
# ~/.uncaged/workflow/config.yaml — 全局配置
defaultAgent: "uwf-hermes"
agentOverrides:
  solve-issue:                      # per-workflow
    developer: "uwf-cursor"
  review-code:
    reviewer: "uwf-hermes"
```

```yaml
# ~/.uncaged/workflow/threads.yaml — active thread 链头指针
01J7K9M2XNPQR5VWBCDF8G3H4T: "8FWKR3TN5V1QA"
01J8AB3QRMSTV6WKXZ2C4DF7GN: "3CNWT9KR6D2HV"
```

Thread 结束时从 threads.yaml 移除。可选：追加到 `history.jsonl` 做归档。

---

## 3. 包结构（精简后）

```
packages/
├── workflow-protocol/    # 类型定义（复用，大幅精简）
├── workflow-cas/         # CAS 存储（复用）
├── workflow-util/        # Base32, ULID, logger（复用）
├── workflow-moderator/   # JSONata moderator 引擎（新，从 #297 演化）
├── workflow-agent-kit/   # Agent CLI 框架（新，含 extractor）
└── cli-workflow/         # wf CLI（重写）
```

6 个包。砍掉 workflow-runtime, workflow-execute, workflow-register, workflow-reactor, workflow-dashboard, workflow-gateway, 4 个 agent adapter, 2 个 template, workflow（根包）。

**可以删除的包（12 个）：**
- `workflow-runtime` — createWorkflow / AsyncGenerator 不再需要
- `workflow-execute` — 引擎循环移到 CLI 的 `step` 命令
- `workflow-register` — ESM bundle 注册不再需要，workflow 是 CAS 节点
- `workflow-reactor` — LLM tool-call 循环移到 agent-kit
- `workflow-dashboard` — 没有长驻进程，不需要 dashboard
- `workflow-gateway` — 同上
- `workflow-agent-cursor` — 变成独立的 `uwf-cursor` CLI
- `workflow-agent-hermes` — 变成独立的 `uwf-hermes` CLI
- `workflow-agent-llm` — 变成独立的 `uwf-llm` CLI
- `workflow-agent-react` — 变成独立的 `uwf-react` CLI
- `workflow-template-develop` — 变成 YAML 文件
- `workflow-template-solve-issue` — 变成 YAML 文件

Agent adapters 从 monorepo 内的包变成独立的 CLI 项目（可以在同一个 monorepo，也可以分出去）。Workflow templates 从 ESM bundle 变成 YAML 文件。
