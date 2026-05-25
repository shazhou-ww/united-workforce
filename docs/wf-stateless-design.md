# `uwf` — Stateless Workflow CLI

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
3. 写 StartNode 到 CAS
4. 在 threads.yaml 中记录链头 → StartNode hash
5. 输出 JSON

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

`done: true` 时 head 仍然有值（最后一个 StepNode），但 thread 已从 threads.yaml 移除。
对已结束或不存在的 thread 调用 step 会报错（非 active thread）。

详细信息通过 `uwf thread show <thread-id>` 或 `json-cas get <head>` 查看。

**做的事：**
1. 读链头 → 当前 StepNode（或 StartNode）
2. 收集 thread 历史（遍历链）
3. 调 moderator：status-based map lookup → 得到下一个 role（或 END）
4. 若 END → 归档 thread，输出最后链头，退出
5. 确定 agent command（`--agent` override > config.yaml per-workflow/role > config.yaml defaultAgent）
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
- agent-kit 根据 thread + role 从 CAS 读 goal / capabilities / procedure / output / meta
- agent-kit 组装完整 prompt（role goal/capabilities/procedure/output + thread context + user prompt from StartNode）
- agent 执行实际逻辑，agent-kit 负责 extract
- agent 将 StepNode 写入 CAS（含 output、detail、agent、prev），但**不挪链头指针**
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

Roles 和 moderator 内联在 Workflow 中，只有 meta 独立为 CAS 节点（方便 json-cas 校验）。

```yaml
type: <workflow-schema-hash>
payload:
  name: "solve-issue"
  description: "End-to-end issue resolution"
  roles:
    planner:
      description: "Creates implementation plan"
      goal: "You are a planning agent..."
      capabilities: [planning, issue-analysis]
      procedure: "Analyze the issue and create a plan."
      output: "Output the plan summary."
      meta: "5GWKR8TN1V3JA"    # cas_ref → JSON Schema 节点（json-cas 内置）
    developer:
      description: "Implements code changes"
      goal: "You are a developer agent..."
      capabilities: [file-edit, shell]
      procedure: "Implement the plan."
      output: "List all files changed."
      meta: "8CNWT4KR6D1HV"    # cas_ref → JSON Schema 节点
    reviewer:
      description: "Reviews code changes"
      goal: "You are a code reviewer..."
      capabilities: [code-review]
      procedure: "Review the implementation."
      output: "Approve or reject with comments."
      meta: "1VPBG9SM5E7WK"    # cas_ref → JSON Schema 节点
  conditions:
    needsClarification:
      description: "Planner requests clarification from user"
      expression: "$exists(steps[-1].output.needsClarification)"
    notApproved:
      description: "Reviewer rejected the implementation"
      expression: "steps[-1].output.approved = false"
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

- `roles` — 内联定义，每个 role 的 `meta` 是独立的 cas_ref（指向 json-cas 内置 JSON Schema 节点）
- `graph` — `Record<Role | "$START", Record<Status, Target>>`，每个 Target = `{ role, prompt }`
- Status 来自上一个 role 输出的 `status` 字段，`$START` 用 `_` 作为初始 status
- Prompt 模板使用 Mustache 渲染，变量来自 lastOutput
- 不含 agent binding — agent 配置在 `~/.uncaged/workflow/config.yaml` 中管理

Moderator 的求值逻辑：

```typescript
evaluate(graph, lastRole, lastOutput) → { role, prompt }
// 1. status = lastRole === "$START" ? "_" : lastOutput.status
// 2. target = graph[lastRole][status]
// 3. prompt = mustache.render(target.prompt, lastOutput)
```

注：routing 基于 `lastOutput.status` 字段的值，直接在 graph map 中查找对应的 Target。

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
  output: "9KRVW3TN5F1QA"         # cas_ref → 结构化输出节点（符合 role 的 meta schema）
  detail: "7BQST3VW9F2MA"         # cas_ref → 执行详情（content node / 子 workflow terminal StepNode / ...）
  agent: "uwf-cursor"              # 实际使用的 agent 命令（纯字符串）
```

- `start` — 每个 StepNode 都直接引用 StartNode，方便随机访问
- `prev` — 前一个 StepNode 的 cas_ref，第一步为 `null`（不指向 StartNode）
- `output` — cas_ref，指向符合 role meta schema 的 CAS 节点，可用 json-cas 校验
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

系统两个顶层 YAML 文件和一个 env 文件：

```yaml
# ~/.uncaged/workflow/config.yaml — 全局配置
providers:
  openai:
    baseUrl: "https://api.openai.com/v1"
    apiKeyEnv: "OPENAI_API_KEY"
  anthropic:
    baseUrl: "https://api.anthropic.com/v1"
    apiKeyEnv: "ANTHROPIC_API_KEY"
  openrouter:
    baseUrl: "https://openrouter.ai/api/v1"
    apiKeyEnv: "OPENROUTER_API_KEY"

models:
  sonnet:
    provider: "openrouter"
    name: "anthropic/claude-sonnet-4"
  gpt4o-mini:
    provider: "openai"
    name: "gpt-4o-mini"

agents:
  hermes:
    command: "uwf-hermes"
    args: []
  cursor:
    command: "uwf-cursor"
    args: []

defaultAgent: "hermes"
agentOverrides:
  solve-issue:
    developer: "cursor"

defaultModel: "sonnet"
modelOverrides:
  extract: "gpt4o-mini"
```

```yaml
# ~/.uncaged/workflow/threads.yaml — active thread 链头指针
01J7K9M2XNPQR5VWBCDF8G3H4T: "8FWKR3TN5V1QA"
01J8AB3QRMSTV6WKXZ2C4DF7GN: "3CNWT9KR6D2HV"
```

Thread 结束时从 threads.yaml 移除。可选：追加到 `history.jsonl` 做归档。

```bash
# ~/.uncaged/workflow/.env — 敏感信息（API keys）
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-...
```

- `config.yaml` — 非敏感配置（agent 命令、model 名、provider 名）
- `.env` — 敏感信息（API keys），agent-kit 启动时自动加载
- `threads.yaml` — 运行时状态

---

## 3. 包结构

全新包，不复用现有 packages，避免命名冲突。CAS 直接依赖 `@uncaged/json-cas`。

```
packages/
├── cli-workflow/              # @uncaged/cli-workflow — uwf CLI（thread/workflow 命令）
├── workflow-moderator/        # @uncaged/workflow-moderator — Status-based moderator 引擎
├── workflow-agent-kit/        # @uncaged/workflow-agent-kit — Agent CLI 框架（含 extractor）
├── workflow-agent-hermes/     # @uncaged/workflow-agent-hermes — uwf-hermes CLI
├── workflow-agent-cursor/ # @uncaged/workflow-agent-cursor — uwf-cursor CLI
└── workflow-protocol/         # @uncaged/workflow-protocol — 共享类型定义
```

**外部依赖：**
- `@uncaged/json-cas` — CAS 存储、hash、schema 校验
- `@uncaged/json-cas-fs` — 文件系统 CAS 后端

**现有包全部保留不动**，新旧并存，逐步迁移。

---

## 4. 关键数据类型

Moderator 通过 status-based map lookup 进行路由。StepNode payload 和上下文中的 step 共享大量字段，提取为公共类型。

### 4.1 公共类型

```typescript
/** CAS hash — XXH64, 13-char Crockford Base32 */
type CasRef = string;

/** Thread ID — ULID, 26-char Crockford Base32 */
type ThreadId = string;

/** 一个 step 的核心数据，被 StepNode payload 和 moderator 上下文共享 */
type StepRecord = {
  role: string;
  output: CasRef;                    // cas_ref → 结构化输出节点（符合 role meta schema）
  detail: CasRef;                    // cas_ref → 执行详情（content node / 子 workflow terminal StepNode）
  agent: string;                     // 实际使用的 agent 命令（纯字符串）
};
```

### 4.2 Workflow 定义

```typescript
type RoleDefinition = {
  description: string;
  goal: string;
  capabilities: string[];
  procedure: string;
  output: string;
  meta: CasRef;                      // cas_ref → json-cas 内置 JSON Schema 节点
};

type Target = {
  role: string;                      // 目标 role 名 或 "$END"
  prompt: string;                    // Mustache 模板，渲染时注入 lastOutput
};

type WorkflowPayload = {
  name: string;
  description: string;
  roles: Record<string, RoleDefinition>;
  graph: Record<string, Record<string, Target>>;  // Record<Role | "$START", Record<Status, Target>>
};
```

### 4.3 Thread 节点

```typescript
type StartNodePayload = {
  workflow: CasRef;                  // cas_ref → Workflow
  prompt: string;
};

type StepNodePayload = StepRecord & {
  start: CasRef;                     // cas_ref → StartNode（每个 step 都引用）
  prev: CasRef | null;               // cas_ref → 前一个 StepNode，第一步为 null
};
```

### 4.4 Moderator 求值

Moderator 使用 `evaluate(graph, lastRole, lastOutput)` 进行同步 status-based routing：

```typescript
// graph[lastRole][lastOutput.status] → Target { role, prompt }
// $START 角色使用 "_" 作为初始 status
// prompt 通过 Mustache 模板渲染，变量来自 lastOutput
```

### 4.5 CLI 输出

```typescript
/** uwf thread start */
type StartOutput = {
  workflow: CasRef;
  thread: ThreadId;
};

/** uwf thread step / uwf thread show */
type StepOutput = {
  workflow: CasRef;
  thread: ThreadId;
  head: CasRef;
  done: boolean;
};

/** uwf thread list */
type ThreadListItem = {
  thread: ThreadId;
  workflow: CasRef;
  head: CasRef;
};
```

### 4.6 配置

```typescript
/** Alias types for config references */
type AgentAlias = string;
type ModelAlias = string;
type ProviderAlias = string;
type WorkflowName = string;
type RoleName = string;
type Scenario = string;              // e.g. "extract"

type ProviderConfig = {
  baseUrl: string;
  apiKeyEnv: string;                 // env var name to read API key from
};

type ModelConfig = {
  provider: ProviderAlias;
  name: string;                      // e.g. "anthropic/claude-sonnet-4", "gpt-4o-mini"
};

type AgentConfig = {
  command: string;
  args: string[];
};

/** ~/.uncaged/workflow/config.yaml */
type WorkflowConfig = {
  providers: Record<ProviderAlias, ProviderConfig>;
  models: Record<ModelAlias, ModelConfig>;
  agents: Record<AgentAlias, AgentConfig>;
  defaultAgent: AgentAlias;
  agentOverrides: Record<WorkflowName, Record<RoleName, AgentAlias>> | null;
  defaultModel: ModelAlias;
  modelOverrides: Record<Scenario, ModelAlias> | null;
};

/** ~/.uncaged/workflow/threads.yaml */
type ThreadsIndex = Record<ThreadId, CasRef>;
//                         ^ thread-id  ^ head StepNode/StartNode hash
```

### 4.7 类型关系图

```
WorkflowConfig (config.yaml)
ThreadsIndex (threads.yaml)          ← 唯二可变状态
    │
    │ thread-id → head hash
    ▼
StepNodePayload ──extends──→ StepRecord ←──maps to──→ StepContext
    │                           │                          │
    ├── start → StartNodePayload│                          │ (output 展开)
    ├── prev → StepNodePayload  │                          │
    │                           ├── role                   ├── role
    │                           ├── output (CasRef)        ├── output (展开)
    │                           ├── detail (CasRef)        ├── detail (CasRef)
    │                           └── agent (string)         └── agent (string)
    │
    └── start.workflow → WorkflowPayload
                             ├── roles: Record<name, RoleDefinition>
                             └── graph: Record<role, Record<status, Target>>
```
