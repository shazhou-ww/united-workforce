# Workflow Coding Conventions

## Project Overview

**@uncaged/workflow** is a workflow engine that executes single-file ESM bundles. Each workflow is a self-contained `.esm.js` file with an XXH64 hash as its version identifier.

### Key Terms

| Concept | What it is |
|---------|-----------|
| **Workflow** | A single-file ESM module that exports `run` (workflow function) and `descriptor` (metadata). Identified by its XXH64 hash (Crockford Base32). |
| **Bundle** | The physical `.esm.js` file stored in `~/.uncaged/workflow/bundles/`. |
| **Thread** | A single execution of a workflow, identified by a ULID. Persisted as `.data.jsonl` + `.info.jsonl`. |
| **Role** | A named actor within a workflow. Each role produces output with typed `meta`. |
| **Registry** | `workflow.yaml` — maps workflow names to current/historical bundle hashes. |

### Monorepo Structure

```
workflow/
  packages/
    workflow/       # @uncaged/workflow — core lib (types, hash, ULID, JSONL, registry)
    cli-workflow/   # @uncaged/cli-workflow — CLI (uncaged-workflow command)
  docs/             # RFCs, conventions
  biome.json        # root Biome config
  tsconfig.json     # root TypeScript config
```

- `workflow` is the core; `cli-workflow` depends on it
- Packages use `workspace:*` protocol

## Language & Paradigm

### Functional-first

Use `function` + `type`, not `class` + `interface`.

```typescript
// ✅ Good
type ThreadStart = {
  name: string;
  hash: string;
  threadId: string;
  timestamp: number;
};

function createThreadStart(name: string, hash: string, threadId: string): ThreadStart {
  return { name, hash, threadId, timestamp: Date.now() };
}

// ❌ Bad — no class, no interface
class ThreadStart implements IThreadStart { ... }
```

### Rules

| Rule | Description |
|------|-------------|
| `type` over `interface` | All type definitions use `type` |
| `function` over `class` | Pure functions + closures, no class |
| No `this` | Functions must not depend on `this` context |
| No inheritance | No `extends`, `implements`, `abstract` |
| Composition over inheritance | Use function composition |
| Immutability first | Use `Readonly<T>`, `as const`, avoid mutation |
| No optional properties | Use `T \| null` instead of `?:` — see below |

### Exceptions

Classes are allowed when:
- Required by a third-party library
- Error subclasses (`class WorkflowError extends Error`)

### No Optional Properties

Never use `?:`. All nullable fields must be explicit `T | null`.

```typescript
// ✅ Good
type WorkflowEntry = {
  hash: string;
  timestamp: number;
  description: string | null;
};

// ❌ Bad
type WorkflowEntry = {
  hash: string;
  timestamp: number;
  description?: string;
};
```

## Modules & Exports

- Always named exports, never default exports
- One module = one responsibility, filename = purpose

Workflow bundles (`.esm.js`) follow the same rule: export `const run` and `const descriptor`, not `export default`.

### Folder Module Discipline

Every folder under `src/` is a **module boundary**. Four rules:

| # | Rule | Rationale |
|---|------|-----------|
| 1 | **Every folder exports via `index.ts`** | Single entry point for the module |
| 2 | **Types live in `types.ts`** | Each folder's type definitions go in `<folder>/types.ts`, not scattered across files |
| 3 | **Single export source** | Only `index.ts` may re-export. No file may re-export from another module's internals. Cross-module imports must go through `index.ts` — never reach past it to import a specific file |
| 4 | **`index.ts` is pure re-exports** | No type definitions, no function implementations — only `export { ... } from` statements |

```typescript
// ✅ Good — import through module boundary
import { createCasStore } from "../cas/index.js";
import type { CasStore } from "../cas/index.js";

// ❌ Bad — reaching past index.ts
import { createCasStore } from "../cas/cas.js";

// ❌ Bad — re-exporting from non-index file
// in engine/engine.ts:
export { createCasStore } from "../cas/cas.js";

// ❌ Bad — types defined in index.ts
// in cas/index.ts:
export type CasStore = { ... };  // should be in cas/types.ts
```

**Exception**: The package-level `src/index.ts` is the public API surface and re-exports from folder `index.ts` files. Files that remain at `src/` root (e.g. `types.ts`, `workflow-as-agent.ts`) are not inside a folder module and follow normal rules.

## Naming

| Type | Style | Example |
|------|-------|---------|
| Files | kebab-case | `thread-manager.ts` |
| Types | PascalCase | `ThreadState` |
| Functions/variables | camelCase | `createThread` |
| Constants | UPPER_SNAKE | `MAX_ROUNDS` |
| Generics | Single letter or descriptive | `T`, `TMeta` |

### Workflow Naming

Workflow names use **verb-first** kebab-case:
- ✅ `solve-issue`, `extract-knowledge`, `review-code`
- ❌ `knowledge-extraction`, `issue-solver`

### ID Encoding

All IDs use **Crockford Base32**:
- Bundle hash: XXH64 → 13-char Crockford Base32
- Thread ID: ULID → 26-char Crockford Base32 (10 timestamp + 16 random)

## Error Handling

- Use `Result` type for expected failures
- `throw` only for unrecoverable bugs (programmer errors)
- No try-catch for flow control

```typescript
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };
```

## Async

- Always `async/await`, never `.then()` chains

## Logging

Never use `console.log/warn/error` directly — Biome's `noConsole` rule enforces this.

All logging goes through the structured logger from `@uncaged/workflow`:

```typescript
import { createLogger } from "@uncaged/workflow";

const log = createLogger();

// Each call site has a fixed 8-char Crockford Base32 tag
log("4KNMR2PX", "Loading workflow bundle...");
log("7BQST3VW", `Role ${role} started`);
```

### Rules

| Rule | Description |
|------|-------------|
| One tag per call site | Tag is a hand-written constant, not generated at runtime |
| Tags are unique | No two `log()` calls in the codebase share the same tag |
| 8-char Crockford Base32 | 40-bit random, generated once when writing the code |
| `console.*` is banned | Biome `noConsole` rule — use `log()` instead |

### Why fixed tags?

- `grep "4KNMR2PX"` in `.info.jsonl` → instant code location
- No need for file/line info in the log — tag is the locator
- Survives refactoring (tag stays the same when code moves)

### CLI entry point exception

The CLI package (`@uncaged/cli-workflow`) may use `console.log` for user-facing output only. Suppress with:

```typescript
// biome-ignore lint/nursery/noConsole: CLI user-facing output
console.log(result);
```

## No Dynamic Import

Do NOT use `await import()` in production code. Always use static top-level `import`.

**Exception**: The bundle loader and `extractBundleExports` dynamically import user workflow files at runtime.

```ts
// Dynamic import required: user bundle path resolved at runtime
const mod = await import(bundlePath);
```

Test files (`__tests__/**`) are exempt.

## Toolchain

| Tool | Purpose |
|------|---------|
| **bun** | Package manager + runtime + test runner |
| **TypeScript** | Type checking (strict mode) |
| **Biome** | Lint + format (replaces ESLint + Prettier) |

### Commands

```bash
bun run check       # tsc --build + biome check
bun run format      # biome format --write
bun test            # run tests
```

## Commit Convention

```
<type>(<scope>): <description>

type: feat | fix | refactor | docs | chore | test
scope: workflow | cli | rfc-001 | ...
```
