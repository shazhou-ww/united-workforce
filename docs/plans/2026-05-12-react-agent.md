# workflow-agent-react — ReAct Agent Package

**Status**: RFC v2
**Author**: 小橘 🍊

## Problem

现有的 agent 包都依赖外部 CLI 进程：

| Package | 机制 | 能力 |
|---------|------|------|
| `workflow-agent-hermes` | spawn `hermes chat` | 完整工具链（文件、终端、浏览器…） |
| `workflow-agent-cursor` | spawn `cursor-agent` | IDE 级别代码编辑 |
| `workflow-agent-llm` | 单轮 chat completion | 纯文本，无工具 |

缺少一个 **内置 ReAct agent**：用 LLM + tool calling 循环执行任务，不依赖外部 CLI，工具集由调用方注入。

## 核心设计变更：AdapterFn 替代 AgentFn

### 现状的问题

当前 `AgentFn` 返回 `string`，engine 再用额外一轮 LLM 调用 extract meta：

```
Agent(ctx) → string → Extract(string, schema) → meta   // 浪费一轮 LLM
```

对于内置 ReAct agent，我们完全可以把 schema 作为 resolve tool 注入循环，agent 直接按 schema 输出结构化结果，**零额外 LLM 调用**。

### 新抽象：AdapterFn

```typescript
type RoleFn<T> = (ctx: ThreadContext) => Promise<T>;

type AdapterFn = <T>(prompt: string, schema: z.ZodType<T>) => RoleFn<T>;
```

- **`prompt`** — role 的 system prompt，描述角色职责和输出要求
- **`schema`** — role 的 meta schema，定义输出格式
- **`ThreadContext`** — threadId, depth, bundleHash, start, steps

prompt 和 schema 是一对：prompt 说"你要输出什么"，schema 定义"输出的格式"。它们属于 role definition，由 `createWorkflow` 在每个 role 执行时传给 adapter。

### AgentContext 不再需要

现有 `AgentContext` 在 `ThreadContext` 上扩展了 `currentRole: { name, systemPrompt }`。prompt 现在直接传给 adapter，context 只需要 thread 信息，因此 `AgentContext` 可以删除。

### createWorkflow 签名变更

```typescript
// Before
type AgentBinding = {
  agent: AgentFn;
  overrides: Partial<Record<string, AgentFn>> | null;
};
function createWorkflow(def, binding: AgentBinding): WorkflowFn;

// After
type AdapterBinding = {
  adapter: AdapterFn;
  overrides: Partial<Record<string, AdapterFn>> | null;
};
function createWorkflow(def, binding: AdapterBinding): WorkflowFn;
```

`createWorkflow` 对每个 role 的执行逻辑：

```typescript
// Before
const result = await agent({ ...threadCtx, currentRole: { name, systemPrompt } });
const meta = await extract(result, role.metaSchema, provider);  // 额外一轮 LLM

// After
const roleFn = adapter(role.systemPrompt, role.metaSchema);
const meta = await roleFn(threadCtx);  // 直接拿到类型安全的 T
```

## AdapterFn 实现

### 1. `createReactAdapter`（本 RFC 核心）

```typescript
type ReactToolHandler = (name: string, args: string) => Promise<string>;

type ReactAdapterConfig = {
  provider: LlmProvider;
  tools: readonly ToolDefinition[];
  toolHandler: ReactToolHandler;
  maxRounds: number;
};

function createReactAdapter(config: ReactAdapterConfig): AdapterFn;
```

内部实现：
1. 接收 `(prompt, schema)` → 生成 resolve tool（schema → JSON Schema → tool definition）
2. 返回 `RoleFn<T>`，执行时：
   - 用 `prompt` 作为 system message
   - 用 thread history 构造 user message
   - 进入 ReAct 循环：LLM 调用工具 → 执行 → 继续
   - 当 LLM 调用 resolve tool → 校验 schema → 返回 `T`
   - 纯文本回复视为错误（prompt 要求 agent 最终调用 resolve）

### 2. `agentToAdapter`（向后兼容包装器）

把现有 `AgentFn`（hermes/cursor）包装成 `AdapterFn`：

```typescript
function agentToAdapter(agent: AgentFn, extractProvider: LlmProvider): AdapterFn {
  return <T>(prompt: string, schema: z.ZodType<T>): RoleFn<T> => {
    return async (ctx: ThreadContext): Promise<T> => {
      // 重建 AgentContext 给旧 agent 用
      const agentCtx = { ...ctx, currentRole: { name: "agent", systemPrompt: prompt } };
      const output = typeof result === "string" ? result : result.output;
      const result = await agent(agentCtx);
      // 走 extract 流程（保持现有行为）
      return extract(output, schema, extractProvider);
    };
  };
}
```

这样 hermes/cursor agent 无需改动，只是在 bundle-entry 层多包一层。

### 3. `createLlmAdapter`（单轮 chat）

```typescript
function createLlmAdapter(provider: LlmProvider): AdapterFn {
  return <T>(prompt: string, schema: z.ZodType<T>): RoleFn<T> => {
    return async (ctx: ThreadContext): Promise<T> => {
      // 单轮 chat，要求 JSON output
      // 用 schema 做 response_format 或 parse 校验
    };
  };
}
```

## ReAct 循环细节

### 终止条件

与 reactor（structured extraction）不同，react adapter 的终止条件是 **agent 调用 resolve tool**：

```
messages = [system(prompt), user(threadHistory)]
for round in 0..maxRounds:
    response = llm({ messages, tools: [...userTools, resolveTool] })
    assistant = parseAssistantMessage(response)
    for each tool_call in assistant.tool_calls:
        if tool_call.name == "resolve":
            validate(tool_call.arguments, schema)
            if valid: return parsed_value
            else: push error feedback, continue loop
        else:
            result = toolHandler(name, arguments)
            push tool result
    if no tool_calls:
        // 纯文本回复 → 提醒 agent 必须调用 resolve
        push correction message, continue loop
throw Error("max rounds exceeded")
```

### resolve tool 生成

```typescript
function buildResolveTool<T>(schema: z.ZodType<T>): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "resolve",
      description: "Submit the final structured output for this role. Call this when the task is complete.",
      parameters: zodToJsonSchema(schema),
    },
  };
}
```

### 与 reactor 的关系

- **复用**：`LlmFn` / `createLlmFn`、`ToolDefinition` / `ToolCall` / `ChatMessage` 类型
- **不复用**：reactor 的 ReAct 循环（终止条件不同）、assistant 消息解析（reactor 有 plain JSON fallback 等多余逻辑）
- **不修改 reactor**：react-agent 自己实现解析（~30 行），保持 reactor 专注 structured extraction

## 包结构

```
packages/workflow-agent-react/
  src/
    types.ts              # ReactAdapterConfig, ReactToolHandler
    resolve-tool.ts       # buildResolveTool (zod → tool definition)
    parse-assistant.ts    # assistant message 解析
    react-loop.ts         # ReAct 循环核心
    create-react-adapter.ts  # AdapterFn 工厂
    index.ts
  __tests__/
    react-loop.test.ts
  package.json
```

依赖：
- `@uncaged/workflow-protocol` — `ThreadContext`, `LlmProvider`
- `@uncaged/workflow-reactor` — `LlmFn`, `createLlmFn`, `ChatMessage`, `ToolDefinition`, `ToolCall`
- `zod` — schema

## 影响范围

### Breaking Changes

| 改动 | 影响 |
|------|------|
| `AgentBinding` → `AdapterBinding` | `createWorkflow` 调用方（所有 bundle-entry） |
| `AgentContext` 删除 | `buildAgentPrompt`（util-agent）需改为接收 `ThreadContext` |
| extract 从 engine 下沉到 adapter | `workflow-execute` 的 engine 简化 |

### 需修改的包

1. `workflow-protocol` — 删除 `AgentContext`，新增 `AdapterFn` / `RoleFn` / `AdapterBinding`
2. `workflow-runtime` — 更新 re-export
3. `workflow-execute` — engine 调用 `adapter(prompt, schema)` 替代 `agent(ctx)` + `extract`
4. `workflow-util-agent` — `buildAgentPrompt` 改为接收 `ThreadContext`
5. `workflow-agent-hermes` / `workflow-agent-cursor` — 不改内部，在 util 层提供 `agentToAdapter`
6. 所有 bundle-entry — `agent:` → `adapter:`

### 不受影响

- `workflow-cas` / `workflow-register` / `workflow-reactor` / `workflow-dashboard`

## Phases

1. **Phase 1**: protocol 层类型定义 + `createWorkflow` 签名变更 + `agentToAdapter` 兼容包装
2. **Phase 2**: `workflow-agent-react` 包 — ReAct 循环 + resolve tool + 测试
3. **Phase 3**: 工具集实现（read/write/patch/shell） + smoke test 闭环

## 工具集（后续讨论）

最小闭环候选，参考 hermes builtin：

| 工具 | 说明 | 优先级 |
|------|------|--------|
| `read_file` | 读文件 | P0 |
| `write_file` | 写文件 | P0 |
| `patch_file` | find-and-replace 编辑 | P0 |
| `shell_exec` | 执行 shell 命令 | P0 |
| `search_files` | grep / find | P1 |
| `list_files` | ls | P1 |
