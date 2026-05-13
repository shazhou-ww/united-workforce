# workflow-agent-react — ReAct Agent Package

**Status**: RFC
**Author**: 小橘 🍊

## Problem

现有的 agent 包都依赖外部 CLI 进程：

| Package | 机制 | 能力 |
|---------|------|------|
| `workflow-agent-hermes` | spawn `hermes chat` | 完整工具链（文件、终端、浏览器…） |
| `workflow-agent-cursor` | spawn `cursor-agent` | IDE 级别代码编辑 |
| `workflow-agent-llm` | 单轮 chat completion | 纯文本，无工具 |

缺少一个 **内置 ReAct agent**：用 LLM + tool calling 循环执行任务，不依赖外部 CLI，工具集由调用方注入。

用途：
1. **Smoke test 闭环** — setup → bundle → add → run → show，用 workflow.yaml 里配置的 provider 直接跑，不需要装 hermes/cursor
2. **轻量 agent** — 只需要读写文件 + 跑命令的场景，不需要启动完整的 CLI agent

## 现有 reactor 的局限

`workflow-reactor` 已有 ReAct 循环，但它是为 **structured extraction** 设计的：

```typescript
// reactor 的终止条件：拿到符合 schema 的 structured output
ThreadReactorFn<TThread> = <T>(args: {
  thread: TThread;
  input: string;
  schema: z.ZodType<T>;     // ← 强制要求
}) => Promise<Result<T, string>>
```

agent 需要的是：**循环调用工具直到任务完成，返回自由文本**。终止条件不同，不适合硬套。

## Design

### 新包 `@uncaged/workflow-agent-react`

依赖：
- `@uncaged/workflow-protocol` — `AgentFn`, `AgentContext`, `LlmProvider` 类型
- `@uncaged/workflow-reactor` — `LlmFn`, `createLlmFn`, `ChatMessage`, `ToolDefinition`, `ToolCall` 类型

```
packages/workflow-agent-react/
  src/
    types.ts
    react-loop.ts         # ReAct 循环核心
    create-react-agent.ts # AgentFn 工厂
    index.ts
  package.json
```

### 类型定义 (`types.ts`)

```typescript
import type { LlmProvider } from "@uncaged/workflow-protocol";
import type { ToolDefinition } from "@uncaged/workflow-reactor";

/**
 * Tool handler: receives tool name + JSON arguments string,
 * returns tool output as string.
 */
type ReactToolHandler = (name: string, args: string) => Promise<string>;

type ReactAgentConfig = {
  provider: LlmProvider;
  tools: readonly ToolDefinition[];
  toolHandler: ReactToolHandler;
  maxRounds: number;
  command: string | null;       // 保持与其他 agent 包一致，此包忽略
};
```

### 工厂函数 (`create-react-agent.ts`)

```typescript
import type { AgentFn } from "@uncaged/workflow-protocol";
import type { ReactAgentConfig } from "./types.js";

function createReactAgent(config: ReactAgentConfig): AgentFn;
```

`AgentFn` 签名是 `(ctx: AgentContext) => Promise<AgentFnResult>`。

执行流程：
1. 从 `ctx.currentRole.systemPrompt` 取 system prompt
2. 用 `buildAgentPrompt(ctx)` 构造完整 user message（含 thread history）
3. 进入 ReAct 循环

### ReAct 循环 (`react-loop.ts`)

```typescript
import type { LlmFn, ChatMessage, ToolDefinition, ToolCall } from "@uncaged/workflow-reactor";
import type { ReactToolHandler } from "./types.js";

type ReactLoopConfig = {
  llm: LlmFn;
  tools: readonly ToolDefinition[];
  toolHandler: ReactToolHandler;
  maxRounds: number;
};

type ReactLoopInput = {
  systemPrompt: string;
  userMessage: string;
};

/**
 * Returns the assistant's final text reply (the first reply without tool calls).
 */
function runReactLoop(config: ReactLoopConfig, input: ReactLoopInput): Promise<string>;
```

**循环逻辑：**

```
messages = [system, user]
for round in 0..maxRounds:
    response = llm({ messages, tools })
    assistant = parseAssistantMessage(response)
    if assistant has tool_calls:
        messages.push(assistant)
        for each tool_call:
            result = toolHandler(name, arguments)
            messages.push({ role: "tool", tool_call_id, content: result })
    else:
        return assistant.content   // ← 终止：纯文本回复 = 任务完成
throw Error("max rounds exceeded")
```

### 需要从 reactor 导出的公共函数

reactor 内部的 assistant message 解析逻辑是私有的。react-agent 需要相同的解析能力。两个方案：

**方案 A：从 reactor 导出解析函数**

```typescript
// workflow-reactor/src/index.ts 新增导出
export { firstAssistantMessage } from "./thread-reactor.js";
export { normalizeToolCalls } from "./thread-reactor.js";
```

**方案 B：react-agent 自己实现解析（~30 行）**

考虑到解析逻辑简单且 reactor 的实现和 react-agent 的需求略有不同（reactor 需要处理 plain JSON fallback，react-agent 不需要），**倾向方案 B**，避免 reactor 为了外部消费调整内部结构。

### bundle-entry 用法

```typescript
// workflows/develop/entry.ts（smoke test 用）
import { createReactAgent } from "@uncaged/workflow-agent-react";
import { createWorkflow } from "@uncaged/workflow-runtime";
import { developWorkflowDefinition, buildDevelopDescriptor } from "@uncaged/workflow-template-develop";

const agent = createReactAgent({
  provider: { baseUrl: "...", apiKey: "...", model: "..." },
  tools: [readFileTool, writeFileTool, shellExecTool],
  toolHandler: handleTool,
  maxRounds: 30,
  command: null,
});

export const descriptor = buildDevelopDescriptor();
export const run = createWorkflow(developWorkflowDefinition, { agent, overrides: null });
```

## 工具集（后续讨论）

最小闭环需要的工具待定，候选参考 hermes builtin：

| 工具 | 说明 | 优先级 |
|------|------|--------|
| `read_file` | 读文件 | P0 |
| `write_file` | 写文件 | P0 |
| `patch_file` | find-and-replace 编辑 | P0 |
| `shell_exec` | 执行 shell 命令 | P0 |
| `search_files` | grep / find | P1 |
| `list_files` | ls | P1 |

工具实现放在 react-agent 包内还是独立包，取决于复用需求。

## 不做的事

- **不泛化 reactor** — reactor 的 structured extraction 循环和 agent 的自由文本循环是两个不同的关注点，不强行统一
- **不处理 childThread** — react-agent 返回纯文本 `string`，不支持嵌套 workflow（那是 `workflowAsAgent` 的事）
- **不内置 system prompt** — 直接用 role definition 里的 `systemPrompt`，不额外包装

## Phases

1. **Phase 1**: 包骨架 + ReAct 循环 + `createReactAgent` + 测试（mock LLM）
2. **Phase 2**: 工具集实现（read/write/patch/shell）
3. **Phase 3**: bundle-entry 集成 + smoke test 闭环
