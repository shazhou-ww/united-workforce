# Office-Agent Document Template 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `workflow-template-document`、`workflow-agent-office`、`workflow-agent-docx-diff` 三个包，通过 `office-agent` CLI 实现 Word 文档生成/编辑 workflow。

**Architecture:** `workflow-template-document` 定义纯结构（roles / moderator / descriptor）；`workflow-agent-office` 直接实现 `AdapterFn`，调用 `office-agent` CLI 生成或编辑文档；`workflow-agent-docx-diff` 直接实现 `AdapterFn`，调用 `docx-diff` CLI 产出差异报告。两个 agent 均跳过 LLM extraction，直接 `schema.parse(JSON.parse(raw))`。

**Tech Stack:** Bun, TypeScript (NodeNext), zod/v4, Biome, bun:test

**Branch:** `user/jiayiyan/feat_office-agent-document-template`（已从最新 main 创建）

---

## 文件清单

### workflow-template-document
| 操作 | 路径 |
|------|------|
| 新建 | `packages/workflow-template-document/package.json` |
| 新建 | `packages/workflow-template-document/tsconfig.json` |
| 新建 | `packages/workflow-template-document/src/types.ts` |
| 新建 | `packages/workflow-template-document/src/roles/writer.ts` |
| 新建 | `packages/workflow-template-document/src/roles/differ.ts` |
| 新建 | `packages/workflow-template-document/src/roles/index.ts` |
| 新建 | `packages/workflow-template-document/src/roles.ts` |
| 新建 | `packages/workflow-template-document/src/moderator.ts` |
| 新建 | `packages/workflow-template-document/src/descriptor.ts` |
| 新建 | `packages/workflow-template-document/src/index.ts` |
| 新建 | `packages/workflow-template-document/__tests__/document-template.test.ts` |

### workflow-agent-office
| 操作 | 路径 |
|------|------|
| 新建 | `packages/workflow-agent-office/package.json` |
| 新建 | `packages/workflow-agent-office/tsconfig.json` |
| 新建 | `packages/workflow-agent-office/src/types.ts` |
| 新建 | `packages/workflow-agent-office/src/runner.ts` |
| 新建 | `packages/workflow-agent-office/src/agent.ts` |
| 新建 | `packages/workflow-agent-office/src/package-descriptor.ts` |
| 新建 | `packages/workflow-agent-office/src/index.ts` |
| 新建 | `packages/workflow-agent-office/__tests__/runner.test.ts` |
| 新建 | `packages/workflow-agent-office/__tests__/agent.test.ts` |

### workflow-agent-docx-diff
| 操作 | 路径 |
|------|------|
| 新建 | `packages/workflow-agent-docx-diff/package.json` |
| 新建 | `packages/workflow-agent-docx-diff/tsconfig.json` |
| 新建 | `packages/workflow-agent-docx-diff/src/types.ts` |
| 新建 | `packages/workflow-agent-docx-diff/src/runner.ts` |
| 新建 | `packages/workflow-agent-docx-diff/src/agent.ts` |
| 新建 | `packages/workflow-agent-docx-diff/src/package-descriptor.ts` |
| 新建 | `packages/workflow-agent-docx-diff/src/index.ts` |
| 新建 | `packages/workflow-agent-docx-diff/__tests__/runner.test.ts` |
| 新建 | `packages/workflow-agent-docx-diff/__tests__/agent.test.ts` |

### 根目录修改
| 操作 | 路径 |
|------|------|
| 修改 | `tsconfig.json` — 追加三个 references |
| 修改 | `docs/architecture.md` — 新增三个包的描述 |

---

## Phase 1：workflow-template-document

### Task 1：包脚手架

**Files:**
- 新建: `packages/workflow-template-document/package.json`
- 新建: `packages/workflow-template-document/tsconfig.json`

- [ ] **Step 1：创建 package.json**

```json
{
  "name": "@uncaged/workflow-template-document",
  "version": "0.1.0",
  "files": ["src", "dist", "package.json"],
  "type": "module",
  "types": "src/index.ts",
  "exports": {
    ".": {
      "bun": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "test": "bun test"
  },
  "dependencies": {
    "@uncaged/workflow-register": "workspace:^",
    "@uncaged/workflow-runtime": "workspace:^",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@uncaged/protocol": "workspace:^"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

- [ ] **Step 2：创建 tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true
  },
  "include": ["src/**/*.ts"],
  "references": [
    { "path": "../protocol" },
    { "path": "../workflow-runtime" },
    { "path": "../workflow-register" }
  ]
}
```

- [ ] **Step 3：在根 tsconfig.json 的 `references` 数组末尾追加**

```json
{ "path": "packages/workflow-template-document" }
```

- [ ] **Step 4：安装依赖**

```bash
cd packages/workflow-template-document && bun install
```

Expected：lockfile 更新，无报错。

---

### Task 2：类型 + 角色 schema（TDD）

**Files:**
- 新建: `packages/workflow-template-document/src/types.ts`
- 新建: `packages/workflow-template-document/src/roles/writer.ts`
- 新建: `packages/workflow-template-document/src/roles/differ.ts`
- 新建: `packages/workflow-template-document/src/roles/index.ts`
- 新建: `packages/workflow-template-document/__tests__/document-template.test.ts`（先写失败测试）

- [ ] **Step 1：创建占位 index.ts**

```typescript
// src/index.ts
export {};
```

- [ ] **Step 2：写失败测试**

```typescript
// __tests__/document-template.test.ts
import { describe, expect, test } from "bun:test";
import { tableToModerator } from "@uncaged/protocol/moderator-table.js";
import { validateWorkflowDescriptor } from "@uncaged/workflow-register";
import { END, type ModeratorContext, type RoleStep, START } from "@uncaged/workflow-runtime";
import { buildDocumentDescriptor } from "../src/descriptor.js";
import { documentTable } from "../src/moderator.js";
import type { DifferMeta, WriterMeta } from "../src/roles/index.js";
import type { DocumentMeta } from "../src/roles.js";

const documentModerator = tableToModerator(documentTable);

function makeCtx(
  steps: ModeratorContext<DocumentMeta>["steps"],
): ModeratorContext<DocumentMeta> {
  return {
    threadId: "01TEST000000000000000000TR",
    depth: 0,
    bundleHash: "TESTHASH00001",
    start: { role: START, content: "", meta: {}, timestamp: 0, parentState: null },
    steps,
  };
}

function writerGenerateStep(): RoleStep<DocumentMeta> {
  return {
    role: "writer",
    contentHash: "STUBHASHWRITER001",
    meta: { mode: "generate", outputDocx: "/out/output.docx", sourceDocx: null } satisfies WriterMeta,
    refs: [],
    timestamp: 1,
  };
}

function writerEditStep(): RoleStep<DocumentMeta> {
  return {
    role: "writer",
    contentHash: "STUBHASHWRITER002",
    meta: { mode: "edit", outputDocx: "/out/modified.docx", sourceDocx: "/out/original.docx" } satisfies WriterMeta,
    refs: [],
    timestamp: 1,
  };
}

function differStep(): RoleStep<DocumentMeta> {
  return {
    role: "differ",
    contentHash: "STUBHASHDIFF001",
    meta: {
      sourceDocx: "/out/original.docx",
      modifiedDocx: "/out/modified.docx",
      diffDocx: "/out/diff.docx",
    } satisfies DifferMeta,
    refs: [],
    timestamp: 2,
  };
}

describe("documentTable", () => {
  test("START → writer", () => {
    expect(documentModerator(makeCtx([]))).toBe("writer");
  });

  test("writer (generate) → END", () => {
    expect(documentModerator(makeCtx([writerGenerateStep()]))).toBe(END);
  });

  test("writer (edit) → differ", () => {
    expect(documentModerator(makeCtx([writerEditStep()]))).toBe("differ");
  });

  test("differ → END", () => {
    expect(documentModerator(makeCtx([writerEditStep(), differStep()]))).toBe(END);
  });
});

describe("buildDocumentDescriptor", () => {
  test("descriptor passes validation", () => {
    const descriptor = buildDocumentDescriptor();
    expect(() => validateWorkflowDescriptor(descriptor)).not.toThrow();
  });

  test("descriptor has writer and differ roles", () => {
    const descriptor = buildDocumentDescriptor();
    expect(Object.keys(descriptor.roles)).toContain("writer");
    expect(Object.keys(descriptor.roles)).toContain("differ");
  });
});
```

- [ ] **Step 3：运行测试，确认失败**

```bash
cd packages/workflow-template-document && bun test
```

Expected：`Cannot find module '../src/moderator.js'` 或类似模块未找到错误。

- [ ] **Step 4：创建 src/types.ts**

```typescript
export type DocumentStartInput = {
  prompt: string;
  inputDocx: string | null;
};
```

- [ ] **Step 5：创建 src/roles/writer.ts**

```typescript
import type { RoleDefinition } from "@uncaged/workflow-runtime";
import * as z from "zod/v4";

export const writerMetaSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("generate"),
    outputDocx: z.string(),
    sourceDocx: z.null(),
  }),
  z.object({
    mode: z.literal("edit"),
    outputDocx: z.string(),
    sourceDocx: z.string(),
  }),
]);

export type WriterMeta = z.infer<typeof writerMetaSchema>;

export const writerRole: RoleDefinition<WriterMeta> = {
  description: "Generates or modifies a Word document via an external agent.",
  systemPrompt: "",
  schema: writerMetaSchema,
};
```

- [ ] **Step 6：创建 src/roles/differ.ts**

```typescript
import type { RoleDefinition } from "@uncaged/workflow-runtime";
import * as z from "zod/v4";

export const differMetaSchema = z.object({
  sourceDocx: z.string(),
  modifiedDocx: z.string(),
  diffDocx: z.string(),
});

export type DifferMeta = z.infer<typeof differMetaSchema>;

export const differRole: RoleDefinition<DifferMeta> = {
  description: "Produces a Word-format diff report of the writer's changes (edit mode only).",
  systemPrompt: "",
  schema: differMetaSchema,
};
```

- [ ] **Step 7：创建 src/roles/index.ts**

```typescript
export { differMetaSchema, differRole } from "./differ.js";
export type { DifferMeta } from "./differ.js";
export { writerMetaSchema, writerRole } from "./writer.js";
export type { WriterMeta } from "./writer.js";
```

---

### Task 3：roles + moderator + descriptor + index 收尾

**Files:**
- 新建: `packages/workflow-template-document/src/roles.ts`
- 新建: `packages/workflow-template-document/src/moderator.ts`
- 新建: `packages/workflow-template-document/src/descriptor.ts`
- 修改: `packages/workflow-template-document/src/index.ts`

- [ ] **Step 1：创建 src/roles.ts**

```typescript
import type { RoleDefinition } from "@uncaged/workflow-runtime";
import { type DifferMeta, differRole } from "./roles/differ.js";
import { type WriterMeta, writerRole } from "./roles/writer.js";

export const DOCUMENT_WORKFLOW_DESCRIPTION =
  "Generates a new Word document from a prompt, or edits an existing one and produces a diff report.";

export type DocumentMeta = {
  writer: WriterMeta;
  differ: DifferMeta;
};

export type DocumentRoles = {
  [K in keyof DocumentMeta]: RoleDefinition<DocumentMeta[K]>;
};

export const documentRoles: DocumentRoles = {
  writer: writerRole,
  differ: differRole,
};
```

- [ ] **Step 2：创建 src/moderator.ts**

```typescript
import {
  END,
  type ModeratorCondition,
  type ModeratorTable,
  START,
} from "@uncaged/workflow-runtime";
import type { DocumentMeta } from "./roles.js";
import type { WriterMeta } from "./roles/writer.js";

const writerIsEditMode: ModeratorCondition<DocumentMeta> = {
  name: "writerIsEditMode",
  description: "Writer ran in edit mode and produced a modified document",
  check: (ctx) => {
    const writerStep = ctx.steps.find((s) => s.role === "writer");
    if (writerStep === undefined) return false;
    return (writerStep.meta as WriterMeta).mode === "edit";
  },
};

export const documentTable: ModeratorTable<DocumentMeta> = {
  [START]: [{ condition: "FALLBACK", role: "writer" }],
  writer: [
    { condition: writerIsEditMode, role: "differ" },
    { condition: "FALLBACK", role: END },
  ],
  differ: [{ condition: "FALLBACK", role: END }],
};
```

- [ ] **Step 3：创建 src/descriptor.ts**

```typescript
import { buildDescriptor } from "@uncaged/workflow-register";
import { documentTable } from "./moderator.js";
import { DOCUMENT_WORKFLOW_DESCRIPTION, documentRoles } from "./roles.js";

export function buildDocumentDescriptor() {
  return buildDescriptor({
    description: DOCUMENT_WORKFLOW_DESCRIPTION,
    roles: documentRoles,
    table: documentTable,
  });
}
```

- [ ] **Step 4：更新 src/index.ts**

```typescript
import type { WorkflowDefinition } from "@uncaged/workflow-runtime";
import { documentTable } from "./moderator.js";
import {
  DOCUMENT_WORKFLOW_DESCRIPTION,
  type DocumentMeta,
  type DocumentRoles,
  documentRoles,
} from "./roles.js";

export { buildDocumentDescriptor } from "./descriptor.js";
export { documentTable } from "./moderator.js";
export {
  type DifferMeta,
  differMetaSchema,
  differRole,
  type WriterMeta,
  writerMetaSchema,
  writerRole,
} from "./roles/index.js";
export {
  DOCUMENT_WORKFLOW_DESCRIPTION,
  type DocumentMeta,
  type DocumentRoles,
  documentRoles,
} from "./roles.js";
export type { DocumentStartInput } from "./types.js";

export const documentWorkflowDefinition: WorkflowDefinition<DocumentMeta> = {
  description: DOCUMENT_WORKFLOW_DESCRIPTION,
  roles: documentRoles,
  table: documentTable,
};
```

- [ ] **Step 5：运行测试，确认通过**

```bash
cd packages/workflow-template-document && bun test
```

Expected：6 tests pass（4 moderator + 2 descriptor）。

- [ ] **Step 6：运行全量构建检查**

```bash
cd /Users/yanjiayi/workspace/workflow && bun run check
```

Expected：无 TypeScript 错误，无 Biome 警告。

- [ ] **Step 7：Commit**

```bash
git add packages/workflow-template-document/ tsconfig.json
git commit -m "feat(template): add workflow-template-document with writer/differ roles and moderator"
```

---

## Phase 2：workflow-agent-office

### Task 4：包脚手架

**Files:**
- 新建: `packages/workflow-agent-office/package.json`
- 新建: `packages/workflow-agent-office/tsconfig.json`

- [ ] **Step 1：创建 package.json**

```json
{
  "name": "@uncaged/workflow-agent-office",
  "version": "0.1.0",
  "files": ["src", "dist", "package.json"],
  "type": "module",
  "types": "src/index.ts",
  "exports": {
    ".": {
      "bun": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "test": "bun test"
  },
  "dependencies": {
    "@uncaged/workflow-runtime": "workspace:^",
    "@uncaged/util": "workspace:^",
    "@uncaged/util-agent": "workspace:^"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

- [ ] **Step 2：创建 tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true
  },
  "include": ["src/**/*.ts"],
  "references": [
    { "path": "../protocol" },
    { "path": "../workflow-runtime" },
    { "path": "../util" },
    { "path": "../util-agent" }
  ]
}
```

- [ ] **Step 3：在根 tsconfig.json 的 `references` 数组末尾追加**

```json
{ "path": "packages/workflow-agent-office" }
```

- [ ] **Step 4：安装依赖**

```bash
cd packages/workflow-agent-office && bun install
```

---

### Task 5：runner 实现（TDD）

**Files:**
- 新建: `packages/workflow-agent-office/src/types.ts`
- 新建: `packages/workflow-agent-office/src/runner.ts`
- 新建: `packages/workflow-agent-office/__tests__/runner.test.ts`

- [ ] **Step 1：写失败测试**

```typescript
// __tests__/runner.test.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, mock, test } from "bun:test";
import { ok, err } from "@uncaged/util";
import type { SpawnCliConfig } from "@uncaged/util-agent";
import { editDocument, generateDocument } from "../src/runner.js";

type MockSpawnResult = Awaited<ReturnType<typeof import("@uncaged/util-agent").spawnCli>>;

function makeSpawn(result: MockSpawnResult) {
  return mock(async (_cmd: string, _args: string[], _opts: SpawnCliConfig) => result);
}

function tempDir(): string {
  const dir = join(tmpdir(), `office-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("generateDocument", () => {
  test("calls office-agent create with correct args and returns outputDocx path", async () => {
    const base = tempDir();
    const spawnFn = makeSpawn(ok("agent reply") as MockSpawnResult);
    // Simulate CLI creating the file
    const outFile = join(base, "thread1", "output.docx");
    mkdirSync(join(base, "thread1"), { recursive: true });
    writeFileSync(outFile, "");

    const result = await generateDocument(
      { outputDir: base, command: "office-agent", timeout: null },
      "thread1",
      "Write a report",
      spawnFn,
    );

    expect(result.outputDocx).toBe(outFile);
    expect(result.sourceDocx).toBeNull();
    expect(spawnFn.mock.calls[0][0]).toBe("office-agent");
    expect(spawnFn.mock.calls[0][1]).toEqual(["create", "Write a report", "-o", "output.docx"]);
    expect(spawnFn.mock.calls[0][2].cwd).toBe(join(base, "thread1"));
  });

  test("uses PATH office-agent when command is null", async () => {
    const base = tempDir();
    const spawnFn = makeSpawn(ok("") as MockSpawnResult);
    mkdirSync(join(base, "t2"), { recursive: true });
    writeFileSync(join(base, "t2", "output.docx"), "");

    await generateDocument(
      { outputDir: base, command: null, timeout: null },
      "t2",
      "Generate",
      spawnFn,
    );

    expect(spawnFn.mock.calls[0][0]).toBe("office-agent");
  });

  test("throws on non_zero_exit", async () => {
    const base = tempDir();
    const spawnFn = makeSpawn(
      err({ kind: "non_zero_exit", exitCode: 1, stdout: "", stderr: "error" }) as MockSpawnResult,
    );

    await expect(
      generateDocument({ outputDir: base, command: null, timeout: null }, "t3", "fail", spawnFn),
    ).rejects.toThrow("office-agent failed (exit 1)");
  });

  test("throws on timeout", async () => {
    const base = tempDir();
    const spawnFn = makeSpawn(err({ kind: "timeout" }) as MockSpawnResult);

    await expect(
      generateDocument({ outputDir: base, command: null, timeout: null }, "t4", "slow", spawnFn),
    ).rejects.toThrow("office-agent: timed out");
  });

  test("throws when output file not created", async () => {
    const base = tempDir();
    const spawnFn = makeSpawn(ok("") as MockSpawnResult);
    // Do NOT create output.docx

    await expect(
      generateDocument({ outputDir: base, command: null, timeout: null }, "t5", "no file", spawnFn),
    ).rejects.toThrow("output file not found");
  });
});

describe("editDocument", () => {
  test("copies input to original.docx and modified.docx, calls edit, returns paths", async () => {
    const base = tempDir();
    // Create a fake inputDocx
    const inputFile = join(base, "source.docx");
    writeFileSync(inputFile, "original content");

    const spawnFn = makeSpawn(ok("") as MockSpawnResult);
    // Simulate CLI overwriting modified.docx
    const outDir = join(base, "te1");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "modified.docx"), "modified content");

    const result = await editDocument(
      { outputDir: base, command: "office-agent", timeout: null },
      "te1",
      "Edit the doc",
      inputFile,
      spawnFn,
    );

    expect(result.outputDocx).toBe(join(outDir, "modified.docx"));
    expect(result.sourceDocx).toBe(join(outDir, "original.docx"));
    expect(spawnFn.mock.calls[0][1]).toEqual(["edit", "modified.docx", "Edit the doc"]);
  });

  test("throws on spawn_failed", async () => {
    const base = tempDir();
    const inputFile = join(base, "src.docx");
    writeFileSync(inputFile, "");
    const spawnFn = makeSpawn(
      err({ kind: "spawn_failed", message: "not found" }) as MockSpawnResult,
    );

    await expect(
      editDocument({ outputDir: base, command: null, timeout: null }, "te2", "edit", inputFile, spawnFn),
    ).rejects.toThrow("spawn failed");
  });
});
```

- [ ] **Step 2：运行测试，确认失败**

```bash
cd packages/workflow-agent-office && bun test __tests__/runner.test.ts
```

Expected：`Cannot find module '../src/runner.js'`

- [ ] **Step 3：创建 src/types.ts**

```typescript
export type OfficeAgentConfig = {
  outputDir: string;
  command: string | null;
  timeout: number | null;
};
```

- [ ] **Step 4：创建 src/runner.ts**

```typescript
import { copyFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { spawnCli } from "@uncaged/util-agent";
import type { OfficeAgentConfig } from "./types.js";

type SpawnCliFn = typeof spawnCli;

function throwSpawnError(e: Awaited<ReturnType<SpawnCliFn>> extends { ok: false; error: infer E } ? E : never): never {
  if (e.kind === "non_zero_exit")
    throw new Error(`office-agent failed (exit ${e.exitCode}): ${e.stderr}`);
  if (e.kind === "timeout")
    throw new Error("office-agent: timed out");
  throw new Error(`office-agent: spawn failed: ${e.message}`);
}

async function assertFileExists(path: string): Promise<void> {
  try {
    await stat(path);
  } catch {
    throw new Error(`office-agent: output file not found: ${path}`);
  }
}

export async function generateDocument(
  config: OfficeAgentConfig,
  threadId: string,
  prompt: string,
  spawnCliFn: SpawnCliFn = spawnCli,
): Promise<{ outputDocx: string; sourceDocx: null }> {
  const outputDir = join(config.outputDir, threadId);
  await mkdir(outputDir, { recursive: true });
  const command = config.command ?? "office-agent";
  const result = await spawnCliFn(command, ["create", prompt, "-o", "output.docx"], {
    cwd: outputDir,
    timeoutMs: config.timeout,
  });
  if (!result.ok) throwSpawnError(result.error);
  const outputDocx = join(outputDir, "output.docx");
  await assertFileExists(outputDocx);
  return { outputDocx, sourceDocx: null };
}

export async function editDocument(
  config: OfficeAgentConfig,
  threadId: string,
  prompt: string,
  inputDocx: string,
  spawnCliFn: SpawnCliFn = spawnCli,
): Promise<{ outputDocx: string; sourceDocx: string }> {
  const outputDir = join(config.outputDir, threadId);
  await mkdir(outputDir, { recursive: true });
  const originalDocx = join(outputDir, "original.docx");
  const modifiedDocx = join(outputDir, "modified.docx");
  await copyFile(inputDocx, originalDocx);
  await copyFile(inputDocx, modifiedDocx);
  const command = config.command ?? "office-agent";
  const result = await spawnCliFn(command, ["edit", "modified.docx", prompt], {
    cwd: outputDir,
    timeoutMs: config.timeout,
  });
  if (!result.ok) throwSpawnError(result.error);
  await assertFileExists(modifiedDocx);
  return { outputDocx: modifiedDocx, sourceDocx: originalDocx };
}
```

> **注意**：`throwSpawnError` 的参数类型可以简化为 `import type { SpawnCliError } from "@uncaged/util-agent"` 直接 import，避免复杂类型推导。把 `throwSpawnError` 的签名改成：
> ```typescript
> import type { SpawnCliError } from "@uncaged/util-agent";
> function throwSpawnError(e: SpawnCliError): never { ... }
> ```

- [ ] **Step 5：运行测试，确认通过**

```bash
cd packages/workflow-agent-office && bun test __tests__/runner.test.ts
```

Expected：7 tests pass。

---

### Task 6：agent + package-descriptor + index（TDD）

**Files:**
- 新建: `packages/workflow-agent-office/src/agent.ts`
- 新建: `packages/workflow-agent-office/src/package-descriptor.ts`
- 修改: `packages/workflow-agent-office/src/index.ts`（新建）

- [ ] **Step 1：写 agent 测试**

```typescript
// __tests__/agent.test.ts
import { describe, expect, test } from "bun:test";
import { packageDescriptor } from "../src/package-descriptor.js";
import { createOfficeAgent } from "../src/agent.js";

describe("createOfficeAgent", () => {
  test("returns an AdapterFn (function)", () => {
    const agent = createOfficeAgent({ outputDir: "/tmp", command: null, timeout: null });
    expect(typeof agent).toBe("function");
  });

  test("AdapterFn returns a RoleFn (function)", () => {
    const agent = createOfficeAgent({ outputDir: "/tmp", command: null, timeout: null });
    const roleFn = agent("", expect.anything() as never);
    expect(typeof roleFn).toBe("function");
  });
});

describe("packageDescriptor", () => {
  test("has correct name", () => {
    expect(packageDescriptor.name).toBe("@uncaged/workflow-agent-office");
  });

  test("has outputDir in configSchema required", () => {
    const schema = packageDescriptor.configSchema as { required: string[] };
    expect(schema.required).toContain("outputDir");
  });
});
```

- [ ] **Step 2：运行测试，确认失败**

```bash
cd packages/workflow-agent-office && bun test __tests__/agent.test.ts
```

Expected：`Cannot find module '../src/agent.js'`

- [ ] **Step 3：创建 src/agent.ts**

```typescript
import * as z from "zod/v4";
import { join } from "node:path";
import type { AdapterFn, RoleResult, ThreadContext, WorkflowRuntime } from "@uncaged/workflow-runtime";
import { createLogger } from "@uncaged/util";
import { editDocument, generateDocument } from "./runner.js";
import type { OfficeAgentConfig } from "./types.js";

const log = createLogger();

type ParsedInput = { prompt: string; inputDocx: string | null };

function parseStartInput(content: string): ParsedInput {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (typeof parsed.prompt === "string") {
      return {
        prompt: parsed.prompt,
        inputDocx: typeof parsed.inputDocx === "string" ? parsed.inputDocx : null,
      };
    }
  } catch {
    // not JSON — treat whole content as prompt, generate mode
  }
  return { prompt: content, inputDocx: null };
}

export function createOfficeAgent(config: OfficeAgentConfig): AdapterFn {
  return <T>(_systemPrompt: string, schema: z.ZodType<T>) =>
    async (ctx: ThreadContext, _runtime: WorkflowRuntime): Promise<RoleResult<T>> => {
      const { prompt, inputDocx } = parseStartInput(ctx.start.content);
      log("8FQKP3NV", `office-agent: mode=${inputDocx === null ? "generate" : "edit"} thread=${ctx.threadId}`);

      let raw: string;
      if (inputDocx === null) {
        const result = await generateDocument(config, ctx.threadId, prompt);
        raw = JSON.stringify({ mode: "generate", outputDocx: result.outputDocx, sourceDocx: null });
      } else {
        const result = await editDocument(config, ctx.threadId, prompt, inputDocx);
        raw = JSON.stringify({ mode: "edit", outputDocx: result.outputDocx, sourceDocx: result.sourceDocx });
      }

      const meta = schema.parse(JSON.parse(raw)) as T;
      return { meta, childThread: null };
    };
}
```

- [ ] **Step 4：创建 src/package-descriptor.ts**

```typescript
import type { PackageDescriptor } from "@uncaged/workflow-runtime";

export const packageDescriptor: PackageDescriptor = {
  name: "@uncaged/workflow-agent-office",
  version: "0.1.0",
  capabilities: ["office-agent-cli", "docx-generate", "docx-edit"],
  configSchema: {
    type: "object",
    required: ["outputDir"],
    properties: {
      outputDir: {
        type: "string",
        description: "Root directory for workflow outputs; subdirs are created per threadId.",
      },
      command: {
        anyOf: [{ type: "string" }, { type: "null" }],
        description: "Path to office-agent CLI binary; null uses PATH.",
      },
      timeout: {
        anyOf: [{ type: "number" }, { type: "null" }],
        description: "Timeout in milliseconds; null means no limit.",
      },
    },
    additionalProperties: false,
  },
};
```

- [ ] **Step 5：创建 src/index.ts**

```typescript
export { createOfficeAgent } from "./agent.js";
export { packageDescriptor } from "./package-descriptor.js";
export type { OfficeAgentConfig } from "./types.js";
```

- [ ] **Step 6：运行所有测试，确认通过**

```bash
cd packages/workflow-agent-office && bun test
```

Expected：全部通过（runner + agent）。

- [ ] **Step 7：运行全量构建检查**

```bash
cd /Users/yanjiayi/workspace/workflow && bun run check
```

Expected：无 TypeScript 错误，无 Biome 警告。

- [ ] **Step 8：Commit**

```bash
git add packages/workflow-agent-office/ tsconfig.json
git commit -m "feat(agent): add workflow-agent-office with generate/edit AdapterFn"
```

---

## Phase 3：workflow-agent-docx-diff

### Task 7：包脚手架

**Files:**
- 新建: `packages/workflow-agent-docx-diff/package.json`
- 新建: `packages/workflow-agent-docx-diff/tsconfig.json`

- [ ] **Step 1：创建 package.json**

```json
{
  "name": "@uncaged/workflow-agent-docx-diff",
  "version": "0.1.0",
  "files": ["src", "dist", "package.json"],
  "type": "module",
  "types": "src/index.ts",
  "exports": {
    ".": {
      "bun": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "test": "bun test"
  },
  "dependencies": {
    "@uncaged/workflow-runtime": "workspace:^",
    "@uncaged/util-agent": "workspace:^",
    "@uncaged/workflow-template-document": "workspace:^"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

- [ ] **Step 2：创建 tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true
  },
  "include": ["src/**/*.ts"],
  "references": [
    { "path": "../protocol" },
    { "path": "../workflow-runtime" },
    { "path": "../util-agent" },
    { "path": "../workflow-template-document" }
  ]
}
```

- [ ] **Step 3：在根 tsconfig.json 的 `references` 数组末尾追加**

```json
{ "path": "packages/workflow-agent-docx-diff" }
```

- [ ] **Step 4：安装依赖**

```bash
cd packages/workflow-agent-docx-diff && bun install
```

---

### Task 8：runner 实现（TDD）

**Files:**
- 新建: `packages/workflow-agent-docx-diff/src/types.ts`
- 新建: `packages/workflow-agent-docx-diff/src/runner.ts`
- 新建: `packages/workflow-agent-docx-diff/__tests__/runner.test.ts`

- [ ] **Step 1：写失败测试**

```typescript
// __tests__/runner.test.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, mock, test } from "bun:test";
import { ok, err } from "@uncaged/util";
import type { SpawnCliConfig } from "@uncaged/util-agent";
import { runDocxDiff } from "../src/runner.js";

type MockSpawnResult = Awaited<ReturnType<typeof import("@uncaged/util-agent").spawnCli>>;

function makeSpawn(result: MockSpawnResult) {
  return mock(async (_cmd: string, _args: string[], _opts: SpawnCliConfig) => result);
}

function tempDir(): string {
  const dir = join(tmpdir(), `diff-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("runDocxDiff", () => {
  test("exit 0: success, returns DifferMeta JSON", async () => {
    const dir = tempDir();
    const sourceDocx = join(dir, "original.docx");
    const modifiedDocx = join(dir, "modified.docx");
    const diffDocx = join(dir, "diff.docx");
    writeFileSync(sourceDocx, "");
    writeFileSync(modifiedDocx, "");

    const spawnFn = makeSpawn(ok("") as MockSpawnResult);
    // simulate docx-diff creating the diff file
    writeFileSync(diffDocx, "");

    const raw = await runDocxDiff(
      { command: "docx-diff" },
      sourceDocx,
      modifiedDocx,
      diffDocx,
      spawnFn,
    );
    const meta = JSON.parse(raw);
    expect(meta.sourceDocx).toBe(sourceDocx);
    expect(meta.modifiedDocx).toBe(modifiedDocx);
    expect(meta.diffDocx).toBe(diffDocx);

    expect(spawnFn.mock.calls[0][1]).toEqual([
      sourceDocx,
      modifiedDocx,
      "--output",
      "docx",
      "--out-file",
      diffDocx,
    ]);
  });

  test("exit 1 (changes found): treated as success", async () => {
    const dir = tempDir();
    const sourceDocx = join(dir, "s.docx");
    const modifiedDocx = join(dir, "m.docx");
    const diffDocx = join(dir, "diff.docx");
    writeFileSync(sourceDocx, "");
    writeFileSync(modifiedDocx, "");
    writeFileSync(diffDocx, "");

    const spawnFn = makeSpawn(
      err({ kind: "non_zero_exit", exitCode: 1, stdout: "", stderr: "" }) as MockSpawnResult,
    );

    await expect(
      runDocxDiff({ command: "docx-diff" }, sourceDocx, modifiedDocx, diffDocx, spawnFn),
    ).resolves.toBeDefined();
  });

  test("exit 2: throws error", async () => {
    const dir = tempDir();
    const spawnFn = makeSpawn(
      err({ kind: "non_zero_exit", exitCode: 2, stdout: "", stderr: "fatal error" }) as MockSpawnResult,
    );

    await expect(
      runDocxDiff({ command: null }, "s.docx", "m.docx", "diff.docx", spawnFn),
    ).rejects.toThrow("docx-diff failed");
  });

  test("timeout: throws error", async () => {
    const spawnFn = makeSpawn(err({ kind: "timeout" }) as MockSpawnResult);

    await expect(
      runDocxDiff({ command: null }, "s.docx", "m.docx", "diff.docx", spawnFn),
    ).rejects.toThrow("timed out");
  });

  test("throws when diff file not created", async () => {
    const dir = tempDir();
    const spawnFn = makeSpawn(ok("") as MockSpawnResult);
    // do NOT create diffDocx

    await expect(
      runDocxDiff({ command: null }, "s.docx", "m.docx", join(dir, "missing.docx"), spawnFn),
    ).rejects.toThrow("diff file not found");
  });

  test("uses PATH docx-diff when command is null", async () => {
    const dir = tempDir();
    const diffDocx = join(dir, "diff.docx");
    writeFileSync(diffDocx, "");
    const spawnFn = makeSpawn(ok("") as MockSpawnResult);

    await runDocxDiff({ command: null }, "s.docx", "m.docx", diffDocx, spawnFn);

    expect(spawnFn.mock.calls[0][0]).toBe("docx-diff");
  });
});
```

- [ ] **Step 2：运行测试，确认失败**

```bash
cd packages/workflow-agent-docx-diff && bun test __tests__/runner.test.ts
```

Expected：`Cannot find module '../src/runner.js'`

- [ ] **Step 3：创建 src/types.ts**

```typescript
export type DocxDiffAgentConfig = {
  command: string | null;
};
```

- [ ] **Step 4：创建 src/runner.ts**

```typescript
import { stat } from "node:fs/promises";
import { spawnCli } from "@uncaged/util-agent";
import type { SpawnCliError } from "@uncaged/util-agent";
import type { DocxDiffAgentConfig } from "./types.js";

type SpawnCliFn = typeof spawnCli;

function throwSpawnError(e: SpawnCliError): never {
  if (e.kind === "non_zero_exit")
    throw new Error(`docx-diff failed (exit ${e.exitCode}): ${e.stderr}`);
  if (e.kind === "timeout")
    throw new Error("docx-diff: timed out");
  throw new Error(`docx-diff: spawn failed: ${e.message}`);
}

export async function runDocxDiff(
  config: DocxDiffAgentConfig,
  sourceDocx: string,
  modifiedDocx: string,
  diffDocx: string,
  spawnCliFn: SpawnCliFn = spawnCli,
): Promise<string> {
  const command = config.command ?? "docx-diff";
  const result = await spawnCliFn(
    command,
    [sourceDocx, modifiedDocx, "--output", "docx", "--out-file", diffDocx],
    { cwd: null, timeoutMs: null },
  );

  if (!result.ok) {
    const e = result.error;
    // exit 1 = changes found (normal)
    if (e.kind === "non_zero_exit" && e.exitCode === 1) {
      // fall through to file check
    } else {
      throwSpawnError(e);
    }
  }

  try {
    await stat(diffDocx);
  } catch {
    throw new Error(`docx-diff: diff file not found: ${diffDocx}`);
  }

  return JSON.stringify({ sourceDocx, modifiedDocx, diffDocx });
}
```

- [ ] **Step 5：运行测试，确认通过**

```bash
cd packages/workflow-agent-docx-diff && bun test __tests__/runner.test.ts
```

Expected：6 tests pass。

---

### Task 9：agent + package-descriptor + index（TDD）

**Files:**
- 新建: `packages/workflow-agent-docx-diff/src/agent.ts`
- 新建: `packages/workflow-agent-docx-diff/src/package-descriptor.ts`
- 新建: `packages/workflow-agent-docx-diff/src/index.ts`
- 新建: `packages/workflow-agent-docx-diff/__tests__/agent.test.ts`

- [ ] **Step 1：写 agent 测试**

```typescript
// __tests__/agent.test.ts
import { describe, expect, test } from "bun:test";
import { packageDescriptor } from "../src/package-descriptor.js";
import { createDocxDiffAgent } from "../src/agent.js";

describe("createDocxDiffAgent", () => {
  test("returns an AdapterFn (function)", () => {
    const agent = createDocxDiffAgent({ command: null });
    expect(typeof agent).toBe("function");
  });

  test("AdapterFn returns a RoleFn (function)", () => {
    const agent = createDocxDiffAgent({ command: null });
    const roleFn = agent("", expect.anything() as never);
    expect(typeof roleFn).toBe("function");
  });
});

describe("packageDescriptor", () => {
  test("has correct name", () => {
    expect(packageDescriptor.name).toBe("@uncaged/workflow-agent-docx-diff");
  });
});
```

- [ ] **Step 2：运行测试，确认失败**

```bash
cd packages/workflow-agent-docx-diff && bun test __tests__/agent.test.ts
```

Expected：`Cannot find module '../src/agent.js'`

- [ ] **Step 3：创建 src/agent.ts**

```typescript
import * as z from "zod/v4";
import { join, dirname } from "node:path";
import type { AdapterFn, RoleResult, ThreadContext, WorkflowRuntime } from "@uncaged/workflow-runtime";
import type { WriterMeta } from "@uncaged/workflow-template-document";
import { runDocxDiff } from "./runner.js";
import type { DocxDiffAgentConfig } from "./types.js";

export function createDocxDiffAgent(config: DocxDiffAgentConfig): AdapterFn {
  return <T>(_prompt: string, schema: z.ZodType<T>) =>
    async (ctx: ThreadContext, _runtime: WorkflowRuntime): Promise<RoleResult<T>> => {
      const writerStep = ctx.steps.find((s) => s.role === "writer");
      if (writerStep === undefined) throw new Error("differ: no writer step found");

      const writerMeta = writerStep.meta as WriterMeta;
      if (writerMeta.mode !== "edit")
        throw new Error("differ: writer did not run in edit mode");

      const diffDocx = join(dirname(writerMeta.outputDocx), "diff.docx");
      const raw = await runDocxDiff(
        config,
        writerMeta.sourceDocx,
        writerMeta.outputDocx,
        diffDocx,
      );

      const meta = schema.parse(JSON.parse(raw)) as T;
      return { meta, childThread: null };
    };
}
```

- [ ] **Step 4：创建 src/package-descriptor.ts**

```typescript
import type { PackageDescriptor } from "@uncaged/workflow-runtime";

export const packageDescriptor: PackageDescriptor = {
  name: "@uncaged/workflow-agent-docx-diff",
  version: "0.1.0",
  capabilities: ["docx-diff-cli", "docx-diff-report"],
  configSchema: {
    type: "object",
    properties: {
      command: {
        anyOf: [{ type: "string" }, { type: "null" }],
        description: "Path to docx-diff CLI binary; null uses PATH.",
      },
    },
    additionalProperties: false,
  },
};
```

- [ ] **Step 5：创建 src/index.ts**

```typescript
export { createDocxDiffAgent } from "./agent.js";
export { packageDescriptor } from "./package-descriptor.js";
export type { DocxDiffAgentConfig } from "./types.js";
```

- [ ] **Step 6：运行所有测试，确认通过**

```bash
cd packages/workflow-agent-docx-diff && bun test
```

Expected：全部通过（runner + agent）。

- [ ] **Step 7：运行全量构建检查**

```bash
cd /Users/yanjiayi/workspace/workflow && bun run check
```

Expected：无 TypeScript 错误，无 Biome 警告。

- [ ] **Step 8：Commit**

```bash
git add packages/workflow-agent-docx-diff/ tsconfig.json
git commit -m "feat(agent): add workflow-agent-docx-diff with docx-diff AdapterFn"
```

---

## Phase 4：收尾

### Task 10：更新 architecture.md + 全量验证

**Files:**
- 修改: `docs/architecture.md`

- [ ] **Step 1：在 architecture.md 的 Package map 表格中补充三个包**

在 `Agent adapters` 分组下（`agent-hermes` 行之后）追加：

```markdown
| | `@uncaged/workflow-agent-office` → `workflow-agent-office` | `AdapterFn` via `office-agent` CLI; generates or edits Word documents, stores outputs per threadId. |
| | `@uncaged/workflow-agent-docx-diff` → `workflow-agent-docx-diff` | `AdapterFn` via `docx-diff` CLI; produces Word-format diff reports for document edit workflows. |
```

在 `Templates` 分组下（`workflow-template-solve-issue` 行之后）追加：

```markdown
| | `@uncaged/workflow-template-document` → `workflow-template-document` | Document generation/editing workflow definition (writer + differ roles, moderator table, descriptor). |
```

- [ ] **Step 2：运行全量测试**

```bash
cd /Users/yanjiayi/workspace/workflow && bun test
```

Expected：所有测试通过，无新增失败。

- [ ] **Step 3：Commit**

```bash
git add docs/architecture.md
git commit -m "docs(architecture): add workflow-agent-office, workflow-agent-docx-diff, workflow-template-document"
```

---

## 验收标准

- [ ] `bun run check` 无错误（TypeScript + Biome）
- [ ] `bun test` 全部通过
- [ ] 三个包均在 `tsconfig.json` references 中
- [ ] `workflow-template-document` 的 moderator 4 个路径均有测试覆盖
- [ ] `workflow-agent-office` runner 测试覆盖：正常生成、正常编辑、非零退出、超时、文件未生成
- [ ] `workflow-agent-docx-diff` runner 测试覆盖：exit 0、exit 1（正常）、exit 2（错误）、超时、diff 文件未生成
