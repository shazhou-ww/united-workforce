# workflow-agent-react — ReAct Agent Package

**Status**: RFC v3
**Author**: 小橘 🍊

## Problem

现有的 agent 包都依赖外部 CLI 进程：

| Package | 机制 | 能力 |
|---------|------|------|
| `agent-hermes` | spawn `hermes chat` | 完整工具链（文件、终端、浏览器…） |
| `workflow-agent-cursor` | spawn `cursor-agent` | IDE 级别代码编辑 |
| `workflow-agent-llm` | 单轮 chat completion | 纯文本，无工具 |

缺少一个 **内置 ReAct agent**：用 LLM + tool calling 循环执行任务，不依赖外部 CLI，工具集由调用方注入。

## 核心设计变更：AdapterFn 替代 AgentFn

### 现状的问题

当前 `AgentFn` 返回 `string`，engine 再用额外一轮 LLM 调用 extract meta：

```
Agent(ctx) → string → Extract(string, schema) → meta   // 浪费一轮 LLM
```

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

`AgentContext` 在 `ThreadContext` 上扩展了 `currentRole: { name, systemPrompt }`。prompt 现在直接传给 adapter，`AgentContext` 可以删除。

### createWorkflow 签名变更

```typescript
// Before
type AgentBinding = {
  agent: AgentFn;
  overrides: Partial<Record<string, AgentFn>> | null;
};

// After
type AdapterBinding = {
  adapter: AdapterFn;
  overrides: Partial<Record<string, AdapterFn>> | null;
};
```

engine 对每个 role 的执行逻辑：

```typescript
// Before
const result = await agent({ ...threadCtx, currentRole: { name, systemPrompt } });
const meta = await extract(result, role.metaSchema, provider);  // 额外一轮 LLM

// After
const roleFn = adapter(role.systemPrompt, role.metaSchema);
const meta = await roleFn(threadCtx);  // 直接拿到类型安全的 T
```

## `createReactAdapter` — 复用 workflow-reactor

AdapterFn 的终止条件是"拿到符合 schema 的 T"——和 `workflow-reactor` 的 `ThreadReactorFn` 完全一致。因此 react adapter 是对 reactor 的**薄包装**，不需要自己实现 ReAct 循环。

```typescript
import { createLlmFn, createThreadReactor } from "@uncaged/workflow-reactor";
import type { ThreadContext, LlmProvider } from "@uncaged/protocol";
import type { ToolDefinition } from "@uncaged/workflow-reactor";

type ReactToolHandler = (name: string, args: string) => Promise<string>;

type ReactAdapterConfig = {
  provider: LlmProvider;
  tools: readonly ToolDefinition[];
  toolHandler: ReactToolHandler;
  maxRounds: number;
};

function createReactAdapter(config: ReactAdapterConfig): AdapterFn {
  return <T>(prompt: string, schema: z.ZodType<T>) => {
    const reactor = createThreadReactor<ThreadContext>({
      llm: createLlmFn(config.provider),
      staticTools: config.tools,
      structuredToolFromSchema: (s) => buildStructuredTool(s),
      systemPromptForStructuredTool: () => prompt,
      toolHandler: (call, ctx) =>
        config.toolHandler(call.function.name, call.function.arguments),
      maxRounds: config.maxRounds,
    });

    return async (ctx: ThreadContext): Promise<T> => {
      const input = buildThreadInput(ctx);
      const result = await reactor({ thread: ctx, input, schema });
      if (!result.ok) throw new Error(result.error);
      return result.value;
    };
  };
}
```

整个包就是：**一个工厂函数 + 类型定义 + thread 输入构造**。

## `agentToAdapter` — 向后兼容

把现有 `AgentFn`（hermes/cursor）包装成 `AdapterFn`：

```typescript
function agentToAdapter(agent: AgentFn, extractProvider: LlmProvider): AdapterFn {
  return <T>(prompt: string, schema: z.ZodType<T>): RoleFn<T> => {
    return async (ctx: ThreadContext): Promise<T> => {
      const agentCtx = { ...ctx, currentRole: { name: "agent", systemPrompt: prompt } };
      const result = await agent(agentCtx);
      const output = typeof result === "string" ? result : result.output;
      return extract(output, schema, extractProvider);
    };
  };
}
```

hermes/cursor agent 内部不改，bundle-entry 层多包一层即可。

## 包结构

```
packages/workflow-agent-react/
  src/
    types.ts                 # ReactAdapterConfig, ReactToolHandler
    create-react-adapter.ts  # AdapterFn 工厂（包装 reactor）
    thread-input.ts          # ThreadContext → user message string
    index.ts
  __tests__/
    create-react-adapter.test.ts
  package.json
```

依赖：
- `@uncaged/protocol` — `ThreadContext`, `LlmProvider`
- `@uncaged/workflow-reactor` — `createLlmFn`, `createThreadReactor`, types

## 影响范围

### Breaking Changes

| 改动 | 影响 |
|------|------|
| `AgentBinding` → `AdapterBinding` | `createWorkflow` 调用方（所有 bundle-entry） |
| `AgentContext` 删除 | `buildAgentPrompt`（util-agent）改为接收 `ThreadContext` |
| extract 从 engine 下沉到 adapter | `workflow-execute` 简化 |

### 需修改的包

1. `protocol` — 删除 `AgentContext`/`AgentFn`/`AgentFnResult`/`AgentBinding`，新增 `AdapterFn`/`RoleFn`/`AdapterBinding`
2. `workflow-runtime` — 更新 re-export
3. `workflow-execute` — engine 调用 `adapter(prompt, schema)` 替代 `agent(ctx) + extract`
4. `util-agent` — `buildAgentPrompt` → `buildThreadInput`，接收 `ThreadContext`
5. 所有 bundle-entry — `agent:` → `adapter:`

### 不受影响

- `workflow-cas` / `workflow-register` / `workflow-reactor` / `dashboard`
- `agent-hermes` / `workflow-agent-cursor`（内部不改，外部用 `agentToAdapter` 包装）

## Phases

1. **Phase 1**: protocol 类型 + `createWorkflow` 签名变更 + `agentToAdapter`
2. **Phase 2**: `workflow-agent-react` 包（包装 reactor）
3. **Phase 3**: 工具集实现（read/write/patch/shell） + smoke test 闭环

## 工具集（后续讨论）

| 工具 | 说明 | 优先级 |
|------|------|--------|
| `read_file` | 读文件 | P0 |
| `write_file` | 写文件 | P0 |
| `patch_file` | find-and-replace 编辑 | P0 |
| `shell_exec` | 执行 shell 命令 | P0 |
| `search_files` | grep / find | P1 |
| `list_files` | ls | P1 |
