# `wf` — Stateless Workflow CLI

> 将 workflow 引擎降维为无状态单步 CLI。Workflow 是纯数据（CAS 节点），执行是单步原子操作，agent 是可插拔外部命令。

---

## 1. CLI Design

### 1.1 命令总览

```
# thread 组
uwf thread start <workflow> -p <prompt>     # 创建 thread，不执行
uwf thread step  <thread-id> [--agent]      # 单步执行
uwf thread show  <thread-id> [--full]       # 查看状态（--full 展开完整历史）
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
// 正常 step
{
  "workflow": "4KNM2PXR3B1QW",
  "thread": "01J7K9M2XNPQR5VWBCDF8G3H4T",
  "progress": {
    "role": "developer",
    "meta": { "filesChanged": ["src/auth.ts"], "summary": "Fixed redirect" },
    "detail": "7BQST3VW9F2MA",   // agent 原始输出的 CAS hash
    "agent": "2RJHV6PN4D8WC"    // 实际使用的 agent 配置 CAS hash
  }
}

// thread 结束
{
  "workflow": "4KNM2PXR3B1QW",
  "thread": "01J7K9M2XNPQR5VWBCDF8G3H4T",
  "progress": null
}
```

**做的事：**
1. 读链头 → 当前 StepNode（或 StartNode）
2. 收集 thread 历史（遍历链）
3. 调 moderator：评估 JSONata conditions → 得到下一个 role（或 END）
4. 若 END → 归档 thread，输出 `progress: null`
5. 确定 agent command（`--agent` override > thread binding > global default）
6. 构建 prompt（role.systemPrompt + thread context + user prompt）
7. 调用：`<agent-cmd> <thread-id>`，捕获 stdout
8. 解析 agent 输出为 progress JSON
9. 写 StepNode 到 CAS（prev → 旧链头）
10. 更新链头指针
11. 输出 JSON

### 1.4 `uwf thread show`

```bash
uwf thread show 01J7K9M2XNPQR5VWBCDF8G3H4T          # 当前状态（最新 StepNode）
uwf thread show 01J7K9M2XNPQR5VWBCDF8G3H4T --full   # 遍历链，打印完整 step 历史
```

纯读操作，不改状态。CAS 节点查看用 `json-cas get <hash>`。

### 1.5 Agent CLI 协议

每个 agent 是一个命令，只接受一个参数 — thread-id：

```bash
uwf-hermes <thread-id>
```

**约定：**
- agent-kit 从 CAS 读 thread 链 → 确定当前 role → 拿到 systemPrompt / extractPrompt / schema
- agent-kit 组装完整 prompt（role systemPrompt + thread context + user prompt from StartNode）
- agent 执行实际逻辑，agent-kit 负责 extract
- stdout → progress 中 `meta` + raw output
- 所有配置从环境变量读（LLM model、API key、extractor config）
- exit 0 = 成功，非 0 = 失败

**stdout 输出格式：**

```jsonc
{
  "meta": { ... },       // 结构化输出，符合 role schema
  "content": "..."       // 原始输出文本（wf 负责存入 CAS）
}
```

agent 框架 package（`@uncaged/workflow-agent-kit`）帮 agent 作者完成：
- 读 thread CAS 构建上下文
- 调实际 agent 逻辑
- 调 extractor LLM 从 raw output 提取 meta
- 格式化 stdout JSON

---

## 2. CAS 结构定义

### 2.1 类型层级

沿用 json-cas 的三层：bootstrap meta-schema → JSON Schema nodes → data nodes。

下面所有 CAS 节点都遵循 `{ type: cas_ref, payload: T, timestamp: number }` 的标准格式。

### 2.2 Schema 节点

以下每个 schema 本身是一个 CAS 节点（type 指向 meta-schema）。

#### `RoleSchema`

```yaml
# 定义一个 role 的 meta 输出格式
# 例：developer role 的输出 schema
type: <meta-schema-hash>
payload:
  $id: "role-output-developer"
  type: object
  properties:
    filesChanged:
      type: array
      items: { type: string }
    summary:
      type: string
  required: [filesChanged, summary]
```

### 2.3 数据节点

#### `Role`

```yaml
type: <role-schema-hash>
payload:
  name: "developer"
  description: "Implements code changes"
  systemPrompt: "You are a developer agent..."
  extractPrompt: "Extract the following from the agent output..."
  outputSchema:
    $ref: "5GWKR8TN1V3JA"    # cas_ref → RoleSchema 节点
```

#### `Moderator`

```yaml
type: <moderator-schema-hash>
payload:
  graph:
    - from: "$START"
      transitions:
        - to: "planner"
          condition: null           # 无条件（default/fallback）
    - from: "planner"
      transitions:
        - to: "developer"
          condition: "$not($exists(meta.needsClarification))"   # JSONata
        - to: "$END"
          condition: null           # fallback
    - from: "developer"
      transitions:
        - to: "reviewer"
          condition: null
    - from: "reviewer"
      transitions:
        - to: "developer"
          condition: "meta.approved = false"    # JSONata
        - to: "$END"
          condition: null
```

JSONata 表达式的求值上下文：

```jsonc
{
  "role": "reviewer",            // 刚完成的 role
  "meta": { "approved": false }, // 刚完成的 role 的 meta
  "depth": 3,                    // 当前第几步
  "history": [                   // 所有历史 steps 的摘要
    { "role": "planner", "meta": { ... } },
    { "role": "developer", "meta": { ... } }
  ]
}
```

#### `Workflow`

```yaml
type: <workflow-schema-hash>
payload:
  name: "solve-issue"
  description: "End-to-end issue resolution"
  roles:
    planner:
      $ref: "3FXJM7QS2A9PB"     # cas_ref → Role
    developer:
      $ref: "8CNWT4KR6D1HV"     # cas_ref → Role
    reviewer:
      $ref: "1VPBG9SM5E7WK"     # cas_ref → Role
  moderator:
    $ref: "6HJQX2FN8C4RA"        # cas_ref → Moderator
  defaultAgent: "uwf-hermes"       # 默认 agent 命令前缀
  agentOverrides:                   # per-role override
    developer: "uwf-cursor"
```

#### `AgentConfig`

```yaml
type: <agent-config-schema-hash>
payload:
  command: "uwf-hermes"
  # 不存 env（从运行环境继承）
  # 不存 thread-id（运行时变量）
  # → 相同 command 的 steps 自然共享同一个 CAS hash
```

为什么只存 command？因为 env 从运行环境继承，不进 CAS。这样同一个 agent 命令在不同 step 间去重为同一个 hash。如果需要记录实际运行时的 env snapshot 用于审计，可以单独存一个 `AgentExecContext` 节点，但不作为默认行为。

#### `StartNode`（Thread 起点）

```yaml
type: <start-node-schema-hash>
payload:
  workflow:
    $ref: "4KNM2PXR3B1QW"         # cas_ref → Workflow
  prompt: "Fix the login bug..."
  agentBinding:                     # 启动时确定的 agent 分配
    planner:
      $ref: "9DSVW3KM7B2PA"        # cas_ref → AgentConfig
    developer:
      $ref: "5RTJN8FQ1H6WC"        # cas_ref → AgentConfig
    reviewer:
      $ref: "9DSVW3KM7B2PA"        # cas_ref → AgentConfig
```

没有 thread-id 在 payload 里 — thread-id 是索引层面的事，不进 CAS 内容。

#### `StepNode`（Thread 每一步）

```yaml
type: <step-node-schema-hash>
payload:
  role: "developer"
  meta:
    filesChanged: ["src/auth.ts"]
    summary: "Fixed redirect loop"
  content:
    $ref: "7BQST3VW9F2MA"         # cas_ref → 原始 agent 输出（content node）
  agent:
    $ref: "5RTJN8FQ1H6WC"         # cas_ref → 实际使用的 AgentConfig
  prev:
    $ref: "2MXBG6PN4A8JR"         # cas_ref → 前一个 StepNode 或 StartNode
```

### 2.4 链式结构

```
threads.json: { "01J7K9M2XNPQR5VWBCDF8G3H4T": "8FWKR3TN5V1QA" }
                                      │
                                      ▼
                              StepNode (step 3)
                              ├── role: "reviewer"
                              ├── meta: { approved: true }
                              ├── content → CAS(raw output)
                              ├── agent → CAS(AgentConfig)
                              └── prev ──→ StepNode (step 2)
                                           ├── role: "developer"
                                           ├── ...
                                           └── prev ──→ StepNode (step 1)
                                                        ├── role: "planner"
                                                        ├── ...
                                                        └── prev ──→ StartNode
                                                                     ├── workflow → CAS(Workflow)
                                                                     ├── prompt: "Fix..."
                                                                     └── agentBinding: {...}
```

### 2.5 可变状态

整个系统唯一的可变文件：

```jsonc
// ~/.uncaged/workflow/threads.json
{
  "01J7K9M2XNPQR5VWBCDF8G3H4T": "8FWKR3TN5V1QA",    // active thread → 链头
  "01J8AB3QRMSTV6WKXZ2C4DF7GN": "3CNWT9KR6D2HV"
}
```

Thread 结束时从这个文件移除。可选：追加一行到 `history.jsonl` 做归档。

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
