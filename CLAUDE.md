# Workflow Coding Conventions

## Project Overview

This monorepo implements a stateless workflow engine driven by a single-step CLI (`uwf`). Workflows are **YAML definitions** stored as CAS nodes; threads are immutable chains of CAS-linked step nodes. No daemon — each `uwf thread step` invocation runs one moderator→agent→extract cycle and exits.

### Key Terms

| Concept | What it is |
|---------|-----------|
| **Workflow** | A YAML definition (`WorkflowPayload`) with roles, status-based routing, and a directed graph. Stored as a CAS node, identified by its XXH64 hash. |
| **Thread** | A single execution of a workflow, identified by a ULID. State is an immutable CAS chain; active threads indexed as `@uwf/thread/*` variables; completed threads as `@uwf/history/*` variables. |
| **Role** | A named actor within a workflow. Each role has a system prompt and a JSON Schema `outputSchema`. |
| **Moderator** | Status-based graph evaluator — determines the next role (or `$END`) with zero LLM cost. |
| **Agent** | An external CLI command (`uwf-hermes`, etc.) spawned by `uwf thread step`. Produces frontmatter markdown output. |
| **CAS** | Content-Addressed Storage via `@ocas/core` — all workflow definitions, thread nodes, and outputs are immutable CAS nodes. |
| **Registry** | `@uwf/registry/*` variables in `~/.ocas/variables.db` — maps workflow names to current CAS hashes. |

### Monorepo Structure

```
workflow/
  packages/
    workflow-protocol/         # @united-workforce/protocol — shared types (WorkflowPayload, StepNodePayload, WorkflowConfig, etc.)
    workflow-util/             # @united-workforce/util — Crockford Base32, ULID, logger, frontmatter parsing/validation
    workflow-util-agent/       # @united-workforce/util-agent — createAgent factory, context builder, extract pipeline
    workflow-agent-hermes/     # @united-workforce/agent-hermes — uwf-hermes CLI binary (spawns hermes chat)
    workflow-agent-claude-code/ # @united-workforce/agent-claude-code — uwf-claude-code CLI binary
    workflow-agent-builtin/    # @united-workforce/agent-builtin — uwf-builtin CLI binary
    cli-workflow/              # @united-workforce/cli — uwf CLI binary (includes status-based moderator in src/moderator/)
    workflow-dashboard/        # @united-workforce/dashboard — web dashboard (private, not published)
  legacy-packages/       # Archived packages (preserved for reference, not active)
  examples/              # Workflow YAML examples (solve-issue.yaml)
  docs/                  # Architecture docs
  biome.json             # root Biome config
  tsconfig.json          # root TypeScript config
```

- Dependency layers: `workflow-protocol` → `workflow-util` → `workflow-util-agent` → `workflow-agent-hermes` / `workflow-agent-claude-code` / `workflow-agent-builtin` / `cli-workflow`
- Packages use `workspace:^` protocol (resolves to `^x.y.z` on publish)
- External CAS: `@ocas/core` (store API, hashing, schema validation) + `@ocas/fs` (filesystem backend)

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
export type CasStore = { ... }; // should be in cas/types.ts
```

**Exception**: The package-level `src/index.ts` is the public API surface and re-exports from folder `index.ts` files. Files that remain at `src/` root (e.g. `types.ts`) are not inside a folder module and follow normal rules.

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
- CAS hash: XXH64 → 13-char Crockford Base32
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

All logging goes through the structured logger from `@united-workforce/util`:

```typescript
import { createLogger } from "@united-workforce/util";

const log = createLogger();

// Each call site has a fixed 8-char Crockford Base32 tag
log("4KNMR2PX", "Loading workflow...");
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

- `grep "4KNMR2PX"` in logs → instant code location
- No need for file/line info in the log — tag is the locator
- Survives refactoring (tag stays the same when code moves)

### CLI entry point exception

The CLI package (`@united-workforce/cli`) may use `console.log` for user-facing output only. Suppress with:

```typescript
// biome-ignore lint/nursery/noConsole: CLI user-facing output
console.log(result);
```

## No Dynamic Import

Do NOT use `await import()` in production code. Always use static top-level `import`.

Test files (`__tests__/**`) are exempt.

## Toolchain

| Tool | Purpose |
|------|---------|
| **bun** | Package manager + runtime |
| **TypeScript** | Type checking (strict mode) |
| **Biome** | Lint + format (replaces ESLint + Prettier) |
| **vitest** | Test runner (`cli-workflow` uses vitest; other packages use `bun test`) |

### Development Workflow

```bash
# ── Setup ──
bun install                 # install all workspace dependencies

# ── Daily development ──
bun run build               # tsc --build (all packages, dependency order)
bun run check               # tsc --build + biome check + lint-log-tags
bun run format              # biome format --write
bun test                    # run tests across all packages

# ── Before committing ──
bun run check               # must pass — typecheck + lint + log tag validation
bun test                    # must pass — all package tests
```

### Publishing

All public `@united-workforce/*` packages are published to **npmjs.org** with **fixed mode** (all packages share the same version number).

```bash
# 1. Add a changeset describing the change
bun changeset

# 2. Bump all package versions + generate CHANGELOGs
bun version

# 3. Build, test, and publish (runs scripts/publish-all.mjs)
bun release

# Or publish manually with a tag:
node scripts/publish-all.mjs --tag alpha
node scripts/publish-all.mjs --dry-run    # preview without publishing
```

- `workspace:^` dependencies resolve to `^x.y.z` on publish
- Publish order defined in `scripts/publish-all.mjs` (dependency order)
- Changesets config: `.changeset/config.json` (fixed mode, public access)

### End-to-end: Author → Register → Run

```
examples/solve-issue.yaml       — write a workflow YAML definition
  │  uwf workflow put
  ▼
~/.ocas/                         — Workflow stored as CAS node (unified CAS store)
~/.ocas/variables.db             — @uwf/registry/* variable maps name → hash
  │  uwf thread start <name> -p "..."
  ▼
~/.ocas/variables.db             — @uwf/thread/* variable tracks head pointer
  │  uwf thread step <thread-id>
  ▼
moderator → agent → extract      — one step per invocation, repeat until $END
```

1. **Author** — write a workflow YAML file with roles, conditions, and graph
2. **Register** — `uwf workflow put <file.yaml>` parses YAML, registers output schemas, stores `WorkflowPayload` in CAS
3. **Run** — `uwf thread start` creates a thread, `uwf thread step` executes one cycle per invocation

## Project Rules

- [docs/sync-readme.md](docs/sync-readme.md) — README sync conventions
- [docs/no-dynamic-import.md](docs/no-dynamic-import.md) — no dynamic import in production code

## Commit Convention

```
<type>(<scope>): <description>

type: feat | fix | refactor | docs | chore | test
scope: workflow | cli | moderator | agent-kit | hermes | util | protocol | ...
```
