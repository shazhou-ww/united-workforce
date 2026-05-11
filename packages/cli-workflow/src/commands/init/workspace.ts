import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { err, ok, type Result } from "@uncaged/workflow-protocol";

import { pathExists } from "../../fs-utils.js";
import type { CmdInitWorkspaceSuccess } from "./types.js";
import { validateWorkspaceSegment } from "./validate.js";

function rootPackageJson(workspaceName: string): string {
  return `${JSON.stringify(
    {
      name: workspaceName,
      private: true,
      type: "module",
      workspaces: ["templates/*", "workflows"],
    },
    null,
    2,
  )}\n`;
}

function workflowsPackageJson(): string {
  return `${JSON.stringify(
    {
      name: "workflows",
      version: "0.0.0",
      private: true,
      type: "module",
      dependencies: {
        "@uncaged/workflow-runtime": "^0.1.0",
        zod: "^4.0.0",
      },
    },
    null,
    2,
  )}\n`;
}

function biomeJson(): string {
  return `${JSON.stringify(
    {
      $schema: "https://biomejs.dev/schemas/2.4.14/schema.json",
      files: {
        includes: ["**", "!**/node_modules", "!**/dist"],
      },
      formatter: {
        indentWidth: 2,
      },
      linter: {
        enabled: true,
        rules: {
          recommended: true,
        },
      },
    },
    null,
    2,
  )}\n`;
}

function tsconfigJson(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        strict: true,
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "Bundler",
        skipLibCheck: true,
      },
    },
    null,
    2,
  )}\n`;
}

function agentsMd(): string {
  return `# AGENTS — Workflow 工作区开发指南

面向在本仓库中编写 workflow 的 coding agent。引擎层术语与架构细节与 **@uncaged/workflow** 上游文档一致，编写时可对照 \`CLAUDE.md\` 与 \`docs/architecture.md\`。

## 1. 项目结构（workspace / template / workflow instance）

| 层级 | 目录 / 产物 | 职责 |
|------|----------------|------|
| **Workspace** | 仓库根（\`package.json\` 含 \`workspaces: ["templates/*", "workflows"]\`） | Bun monorepo：统一管理本地模板包与 workflow 实例 |
| **Template** | \`templates/<name>/\`（如 \`src/roles.ts\`、\`src/moderator.ts\`、\`src/index.ts\`） | 纯数据：**WorkflowDefinition**（各 **RoleDefinition** + **Moderator**），**不绑定**具体 Agent |
| **Workflow instance** | \`workflows/\`（或单独包） | 把模板与运行时 **AgentFn** / **ExtractFn** 组合，产出可注册的 **单文件 ESM bundle**（\`run\` + \`descriptor\` 命名导出） |

Init 生成的骨架：\`templates/\` 下放可复用定义，\`workflows/\` 下放绑定与打包入口。

## 2. 核心概念

- **RoleMeta**：\`Record<string, Record<string, unknown>>\`，角色名 → 该角色结构化 meta 的形状约定。
- **RoleDefinition<Meta>**：纯数据——\`description\`、\`systemPrompt\`、\`schema\`（Zod v4）。不含执行逻辑。
- **WorkflowDefinition<M extends RoleMeta>**：\`description\` + \`roles\`（各角色定义）+ **Moderator**。
- **Moderator**：\`(ctx: ModeratorContext<M>) => (角色名) | END\`。同步、纯函数，只做路由。
- **AgentFn**：\`(ctx: AgentContext) => Promise<string>\`，原始文本输出；从上下文读取当前角色的 \`systemPrompt\`。
- **ExtractFn**：从 CAS content hash 解析结构化数据（引擎与 Agent 都可使用）。

引擎循环简述：**Moderator** → 选角色 → **Agent** 产出文本 → **Extract** 写入 **meta** → 追加 step，重复直至 **END**。详见 \`docs/architecture.md\` 中的三阶段说明。

## 3. 开发流程

1. **定义 RoleMeta**：为每个角色约定 meta 的 TypeScript 类型（与 Zod schema 对齐）。
2. **编写 RoleDefinition**：为每个角色写 Zod \`schema\`，补齐 \`systemPrompt\` / \`description\`。
3. **编写 Moderator**：根据 \`ctx.steps\` 与业务状态返回下一个角色名或 \`END\`。
4. **组装 WorkflowDefinition**：在模板 \`index\` 中导出 definition（以及必要的角色 / moderator 导出）。
5. **实例化**：在 workflow 包中使用 \`createWorkflow(def, binding)\`（或项目约定的封装）绑定 **AgentFn**；**ExtractFn** 由引擎从 **workflow.yaml** 注入 \`WorkflowRuntime\`。
6. **构建**：打包为单个 **.esm.js** bundle，使用 **uncaged-workflow add** 注册。

## 4. 编码规范

与 **CLAUDE.md** 对齐，摘要如下：

- **Functional-first**：优先 \`function\` + \`type\`，避免面向对象业务模型。
- **type 而非 interface**：类型别名一律用 \`type\`，不要使用 \`interface\`。
- **显式可空**：不要用 \`?:\`；可空字段写成 \`T | null\`。
- **function 而非 class**：不用 class（第三方库要求或 \`Error\` 子类除外）。
- **Crockford Base32**：日志 tag、bundle hash、thread id 等标识约定（引擎侧）；工作区内自定义日志若沿用引擎 logger，tag 为 8 字符 Crockford Base32，且每个调用点唯一。
- **Named exports only**：不要使用 **default export**；workflow bundle 须 **export const run** 与 **export const descriptor**。
- **No console.log**：库代码用结构化 logger；CLI 用户输出可按项目 Biome 规则例外标注。
- **No dynamic import**：业务与 bundle 内禁止 \`import()\`；例外仅限「运行时路径由用户提供的 bundle 加载器」（引擎内部）。

## 5. Template 复用

- **已发布模板**：可通过 npm 依赖 \`@uncaged/workflow-template-*\` 等包，在 workflow 实例中 import 其 **WorkflowDefinition** 再绑定 Agent。
- **本地模板**：放在本仓库 \`templates/<name>/\`，由 workspace 协议引用（如 \`"template-foo": "workspace:*"\` 或相对路径），便于同源修改与版本控制。

选择模板时保持 **definition 与 agent 绑定分离**：模板只描述「做什么、顺序如何」，实例决定「谁执行、如何抽取 meta」。

## 6. Build and Test

日常命令：

\`\`\`sh
bun install
bun run check    # Biome：lint + format
bun test
bun build        # 若包内配置了 build 脚本则用于产出 dist / bundle
uncaged-workflow add <name> <path/to/bundle.esm.js>
\`\`\`

提交前至少运行 **bun run check** 与 **bun test**；registry 与本地运行流参见 README 与 CLI 文档。

## 7. 常见陷阱

- **No dynamic import**：bundle 须静态可分析；动态 \`import()\` 会破坏哈希与加载约束。
- **No default export**：引擎只接受命名导出 \`run\` / \`descriptor\`。
- **No console.log**：避免在可被 Biome \`noConsole\` 规则覆盖的代码路径直接使用 console。
- **Single-file ESM bundle**：交付物是单一 \`.esm.js\`；静态 import 仅限 Node 内置（见 architecture 文档中的 Bundle Contract）。

---

编写新 workflow 时，先对齐 **RoleMeta → RoleDefinition（Zod）→ Moderator → 绑定 → 单文件 bundle**，再对照本节规范自检。
`;
}

function readmeMd(workspaceName: string): string {
  return `# ${workspaceName}

Local workflow development workspace (Bun monorepo).

## Layout

- \`templates/\` — reusable workflow definition packages (roles + moderator), no agent binding
- \`workflows/\` — workflow instances that bind templates to agents and export \`run\` + \`descriptor\`

## Commands

\`\`\`sh
bun install
bun run check   # after you add scripts / Biome
uncaged-workflow add <name> <bundle.esm.js>
uncaged-workflow run <name>
\`\`\`

Create this skeleton with:

\`\`\`sh
uncaged-workflow init workspace ${workspaceName}
\`\`\`
`;
}

export async function cmdInitWorkspace(
  parentDir: string,
  workspaceName: string,
): Promise<Result<CmdInitWorkspaceSuccess, string>> {
  const validated = validateWorkspaceSegment(workspaceName);
  if (!validated.ok) {
    return validated;
  }

  const rootPath = join(parentDir, workspaceName);
  if (await pathExists(rootPath)) {
    return err(`directory already exists: ${rootPath}`);
  }

  await mkdir(rootPath, { recursive: false });
  await mkdir(join(rootPath, "templates"), { recursive: false });
  await mkdir(join(rootPath, "workflows"), { recursive: false });

  await Promise.all([
    writeFile(join(rootPath, "package.json"), rootPackageJson(workspaceName), "utf8"),
    writeFile(join(rootPath, "biome.json"), biomeJson(), "utf8"),
    writeFile(join(rootPath, "tsconfig.json"), tsconfigJson(), "utf8"),
    writeFile(join(rootPath, "AGENTS.md"), agentsMd(), "utf8"),
    writeFile(join(rootPath, "README.md"), readmeMd(workspaceName), "utf8"),
    writeFile(join(rootPath, "templates", ".gitkeep"), "", "utf8"),
    writeFile(join(rootPath, "workflows", "package.json"), workflowsPackageJson(), "utf8"),
  ]);

  return ok({ rootPath });
}
