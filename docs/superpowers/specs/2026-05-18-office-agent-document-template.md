# 设计文档：office-agent 文档生成/编辑 Workflow 体系

**日期：** 2026-05-18

---

## 概述

在 monorepo 中新增三个包，实现通过 `office-agent` CLI 生成或编辑 Word 文档的完整 workflow 体系。

| 包 | npm name | 职责 |
|---|---|---|
| `workflow-template-document` | `@uncaged/workflow-template-document` | 纯结构：角色定义、meta schema、调度表、descriptor |
| `workflow-agent-office` | `@uncaged/workflow-agent-office` | writer 角色执行器：调用 `office-agent` CLI |
| `workflow-agent-docx-diff` | `@uncaged/workflow-agent-docx-diff` | differ 角色执行器：调用 `docx-diff` CLI |

Template 只定义结构，不含执行逻辑。执行器与 template 解耦。

---

## 一、`workflow-template-document`

### Thread 启动输入

```typescript
// src/types.ts
type DocumentStartInput = {
  prompt: string;           // 用户指令
  inputDocx: string | null; // null = 生成模式；本机绝对路径 = 编辑模式
};
```

start.content 为 JSON `{ prompt, inputDocx }` 或纯文本（fallback：generate 模式，整段作为 prompt）。

### 角色与 Meta

`WriterMeta` 使用 discriminated union，在 schema 层区分两种模式：

```typescript
const writerMetaSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("generate"),
    outputDocx: z.string(),   // 生成产物绝对路径
    sourceDocx: z.null(),
  }),
  z.object({
    mode: z.literal("edit"),
    outputDocx: z.string(),   // 修改后产物：<outputDir>/modified.docx
    sourceDocx: z.string(),   // 原始副本：<outputDir>/original.docx
  }),
]);
type WriterMeta = z.infer<typeof writerMetaSchema>;

// differ：仅编辑模式执行
const differMetaSchema = z.object({
  sourceDocx: z.string(),
  modifiedDocx: z.string(),
  diffDocx: z.string(),
});
type DifferMeta = z.infer<typeof differMetaSchema>;
```

两个角色的 `systemPrompt` 均为 `""`。

### 调度表

```
START → writer ──(mode = "edit")──→ differ → END
               ↘(mode = "generate")→ END
```

### 公开导出

template 导出两个对象供消费方使用：

- `documentWorkflowDefinition: WorkflowDefinition<DocumentMeta>` — 传入 `createWorkflow` 的 `def` 参数
- `buildDocumentDescriptor(): WorkflowDescriptor` — bundle 导出用

```typescript
// bundle 侧用法
export const descriptor = buildDocumentDescriptor();
export const run = createWorkflow(documentWorkflowDefinition, { adapter, overrides });
```

### 包文件结构

```
packages/workflow-template-document/
  src/
    types.ts           # DocumentStartInput
    roles/
      writer.ts        # writerMetaSchema, WriterMeta, writerRole
      differ.ts        # differMetaSchema, DifferMeta, differRole
      index.ts
    roles.ts           # DocumentMeta, documentRoles
    moderator.ts       # writerIsEditMode condition + documentTable
    definition.ts      # documentWorkflowDefinition
    descriptor.ts      # buildDocumentDescriptor()
    index.ts
  __tests__/
    moderator.test.ts
  package.json
  tsconfig.json
```

### 依赖

```json
{
  "@uncaged/workflow-protocol": "workspace:^",
  "@uncaged/workflow-runtime": "workspace:^",
  "@uncaged/workflow-register": "workspace:^",
  "zod": "^4.0.0"
}
```

---

## 二、`workflow-agent-office`

### office-agent CLI 接口

```bash
# 生成模式：在 CWD 生成 output.docx
office-agent create "<prompt>" -o output.docx

# 编辑模式：在 CWD 对 modified.docx 进行修改（覆写）
office-agent edit modified.docx "<instruction>"
```

- 两个命令均为阻塞调用（CLI 内部消费 SSE，退出即完成）
- 输出文件落到调用方设定的 CWD
- 退出码 0 = 成功，非零 = 失败

### 文件命名约定

| 模式 | 文件 | 路径 |
|---|---|---|
| generate | 输出 | `<outputDir>/output.docx` |
| edit | 原始副本（workflow-owned 快照） | `<outputDir>/original.docx` |
| edit | 修改后产物 | `<outputDir>/modified.docx` |

edit 模式先将 `inputDocx` 复制为 `original.docx`（不可变快照），再复制为 `modified.docx`，对 `modified.docx` 调用 CLI。agent 覆写 `modified.docx`，`original.docx` 保持不变。differ 对比这两个 workflow-owned 文件，不依赖用户原始路径。

### 执行流程

**生成模式（`inputDocx = null`）：**
1. `mkdir -p <outputDir>`（`<config.outputDir>/<ctx.threadId>`）
2. `const command = config.command ?? "office-agent"`
3. `spawnCli(command, ["create", prompt, "-o", "output.docx"], { cwd: outputDir, timeoutMs })`
4. 验证 `outputDir/output.docx` 存在
5. 返回 `JSON.stringify({ mode: "generate", outputDocx, sourceDocx: null })`

**编辑模式（`inputDocx ≠ null`）：**
1. `mkdir -p <outputDir>`
2. `copyFile(inputDocx, <outputDir>/original.docx)`
3. `copyFile(inputDocx, <outputDir>/modified.docx)`
4. `const command = config.command ?? "office-agent"`
5. `spawnCli(command, ["edit", "modified.docx", prompt], { cwd: outputDir, timeoutMs })`
6. 验证 `outputDir/modified.docx` 存在
7. 返回 `JSON.stringify({ mode: "edit", outputDocx: modifiedPath, sourceDocx: originalPath })`

### AdapterFn 实现（直接实现，不经过 runtime.extract）

CLI 产出确定性 JSON，直接 `schema.parse(JSON.parse(raw))` 跳过 LLM extraction：

```typescript
export function createOfficeAgent(config: OfficeAgentConfig): AdapterFn {
  return <T>(_systemPrompt: string, schema: z.ZodType<T>) =>
    async (ctx: ThreadContext, _runtime: WorkflowRuntime): Promise<RoleResult<T>> => {
      const { prompt, inputDocx } = parseStartInput(ctx.start.content);
      const raw = await runOfficeAgent(config, ctx.threadId, prompt, inputDocx);
      const meta = schema.parse(JSON.parse(raw)) as T;
      return { meta, childThread: null };
    };
}
```

`_systemPrompt` 为 writer 角色的 systemPrompt（空字符串），实际指令从 `ctx.start.content` 解析。

### 配置

```typescript
type OfficeAgentConfig = {
  outputDir: string;        // 输出根目录，runner 在此下按 threadId 建子目录
  command: string | null;   // null → runner 内 resolve 为 "office-agent"
  timeout: number | null;   // null → 不设超时；单位 ms
};
```

### 错误处理

```typescript
if (!result.ok) {
  const e = result.error;
  if (e.kind === "non_zero_exit")
    throw new Error(`office-agent failed (exit ${e.exitCode}): ${e.stderr}`);
  if (e.kind === "timeout")
    throw new Error("office-agent: timed out");
  // "spawn_failed"
  throw new Error(`office-agent: spawn failed: ${e.message}`);
}
if (!existsSync(expectedPath))
  throw new Error(`office-agent: output file not found: ${expectedPath}`);
```

### packageDescriptor

```typescript
// src/package-descriptor.ts
export const packageDescriptor: PackageDescriptor = {
  name: "@uncaged/workflow-agent-office",
  version: "0.1.0",
  capabilities: ["office-agent-cli", "docx-generate", "docx-edit"],
  configSchema: {
    type: "object",
    required: ["outputDir"],
    properties: {
      outputDir: { type: "string", description: "Root directory for workflow outputs." },
      command:   { anyOf: [{ type: "string" }, { type: "null" }], description: "Path to office-agent CLI; null uses PATH." },
      timeout:   { anyOf: [{ type: "number" }, { type: "null" }], description: "Timeout in ms; null means no limit." },
    },
    additionalProperties: false,
  },
};
```

### 包文件结构

```
packages/workflow-agent-office/
  src/
    types.ts                # OfficeAgentConfig, OfficeAgentOpt
    runner.ts               # runOfficeAgent()（spawnCli 封装 + 文件验证）
    agent.ts                # createOfficeAgent(): AdapterFn
    package-descriptor.ts   # packageDescriptor
    index.ts
  __tests__/
    runner.test.ts
    agent.test.ts
  package.json
  tsconfig.json
```

### 依赖

```json
{
  "@uncaged/workflow-protocol": "workspace:^",
  "@uncaged/workflow-util": "workspace:^",
  "@uncaged/workflow-util-agent": "workspace:^"
}
```

---

## 三、`workflow-agent-docx-diff`

`differ` 角色专用执行器。从 `ctx.steps` 读取 `WriterMeta`，调用本地 `docx-diff` CLI。

### docx-diff 退出码约定

| 退出码 | 含义 | runner 处理 |
|---|---|---|
| 0 | 无差异 | 正常，验证 diffDocx 存在 |
| 1 | 有差异 | 正常（显式处理为成功），验证 diffDocx 存在 |
| 2+ | 错误 | throw |

runner 收到 `SpawnCliError { kind: "non_zero_exit", exitCode: 1 }` 时视为成功，验证文件后继续；`exitCode >= 2` 才 throw。

### 执行流程

```
1. 从 ctx.steps 找到 writer 步骤，读取 WriterMeta
2. 验证 mode === "edit"（否则 throw）
3. diffDocx = join(dirname(writer.outputDocx), "diff.docx")
4. const command = config.command ?? "docx-diff"
5. spawnCli(command,
     [writer.sourceDocx, writer.outputDocx, "--output", "docx", "--out-file", diffDocx],
     { cwd: null, timeoutMs: null })
   exit 0 或 1 → 验证 diffDocx 存在
   exit 2+ → throw
6. 返回 JSON.stringify({ sourceDocx, modifiedDocx: writer.outputDocx, diffDocx })
```

### AdapterFn 实现（直接实现，不经过 runtime.extract）

```typescript
export function createDocxDiffAgent(config: DocxDiffAgentConfig = { command: null }): AdapterFn {
  return <T>(_prompt: string, schema: z.ZodType<T>) =>
    async (ctx: ThreadContext, _runtime: WorkflowRuntime): Promise<RoleResult<T>> => {
      const writerStep = ctx.steps.find(s => s.role === "writer");
      if (!writerStep) throw new Error("differ: no writer step found");
      const writerMeta = writerStep.meta as WriterMeta;
      if (writerMeta.mode !== "edit")
        throw new Error("differ: writer did not run in edit mode");
      const raw = await runDocxDiff(config, writerMeta);
      const meta = schema.parse(JSON.parse(raw)) as T;
      return { meta, childThread: null };
    };
}
```

### 配置

```typescript
type DocxDiffAgentConfig = {
  command: string | null;   // null → runner 内 resolve 为 "docx-diff"
};
```

### packageDescriptor

```typescript
export const packageDescriptor: PackageDescriptor = {
  name: "@uncaged/workflow-agent-docx-diff",
  version: "0.1.0",
  capabilities: ["docx-diff-cli", "docx-diff-report"],
  configSchema: {
    type: "object",
    properties: {
      command: { anyOf: [{ type: "string" }, { type: "null" }], description: "Path to docx-diff CLI; null uses PATH." },
    },
    additionalProperties: false,
  },
};
```

### 包文件结构

```
packages/workflow-agent-docx-diff/
  src/
    types.ts                # DocxDiffAgentConfig
    runner.ts               # runDocxDiff()（exit 1 处理 + 文件验证）
    agent.ts                # createDocxDiffAgent(): AdapterFn
    package-descriptor.ts   # packageDescriptor
    index.ts
  __tests__/
    runner.test.ts
    agent.test.ts
  package.json
  tsconfig.json
```

### 依赖

```json
{
  "@uncaged/workflow-protocol": "workspace:^",
  "@uncaged/workflow-util-agent": "workspace:^",
  "@uncaged/workflow-template-document": "workspace:^"
}
```

---

## 四、外部 bundle（外部 workspace 消费）

```typescript
import { createOfficeAgent } from "@uncaged/workflow-agent-office";
import { createDocxDiffAgent } from "@uncaged/workflow-agent-docx-diff";
import {
  buildDocumentDescriptor,
  documentWorkflowDefinition,
} from "@uncaged/workflow-template-document";
import { createWorkflow } from "@uncaged/workflow-runtime";
import { getDefaultWorkflowStorageRoot } from "@uncaged/workflow-util";
import { join } from "node:path";

const outputDir = join(getDefaultWorkflowStorageRoot(), "outputs");

export const descriptor = buildDocumentDescriptor();
export const run = createWorkflow(documentWorkflowDefinition, {
  adapter: createOfficeAgent({ outputDir, command: null, timeout: null }),
  overrides: { differ: createDocxDiffAgent() },
});
```

---

## 不在范围内

- 重试逻辑（失败直接 throw）
- office-agent server 的启停管理（假设 server 已在运行）
- docx-diff HTML/terminal 格式输出（仅 docx）
- 跨机器执行（`inputDocx` 须为本机有效绝对路径）
