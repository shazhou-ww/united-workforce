# RFC-001: Workflow Engine Design

**Author:** 小橘 🍊（NEKO Team）
**Date:** 2026-05-06
**Status:** Draft

---

## 1. Package Structure

| Package | npm Name | Binary |
|---------|----------|--------|
| Core lib | `@uncaged/workflow` | — |
| CLI | `@uncaged/cli-workflow` | `uncaged-workflow` |

Future: `@uncaged/cli` umbrella, invoke via `uncaged workflow <subcommand>`.

Monorepo uses **bun workspace**.

## 2. Workflow Physical Implementation

A **Workflow** is a single-file ESM module that **named-exports** an **AsyncGenerator** function as `run` and workflow metadata as `descriptor`:

```typescript
/** What each yield produces — one role's output. */
type RoleOutput = {
  role: string;
  content: string;
  meta: Record<string, unknown>;
};

/** What the generator returns when done. */
type WorkflowResult = {
  returnCode: number;
  summary: string;
};

/** Input to a workflow — prompt + optional historical steps for fork/resume. */
type ThreadInput = {
  prompt: string;
  steps: RoleOutput[];   // [] for new thread, pre-filled for fork/resume
};

/** The bundle contract — an AsyncGenerator, not a Promise. */
type WorkflowFn = (
  input: ThreadInput,
  options: { isDryRun: boolean; maxRounds: number }
) => AsyncGenerator<RoleOutput, WorkflowResult>;
```

### Why AsyncGenerator?

The workflow **yields** each role output instead of writing to an injected writer or
exporting a framework-specific shape:

```typescript
// Example bundle — zero framework dependency (named exports only)
export const descriptor = {
  description: "Fix auth bug",
  roles: {
    planner: {
      description: "Plans the fix",
      schema: { type: "object", properties: { files: { type: "array", items: { type: "string" } } } },
    },
    coder: {
      description: "Implements the plan",
      schema: { type: "object", properties: { diff: { type: "string" } } },
    },
  },
};

export const run = async function* (input, options) {
  const plan = await callLLM("plan: " + input.prompt);
  yield { role: "planner", content: plan, meta: { files: ["src/auth.ts"] } };

  const code = await callLLM("implement: " + plan);
  yield { role: "coder", content: code, meta: { diff: "..." } };

  return { returnCode: 0, summary: "Fixed auth bug" };
};
```

**Engine controls the loop**, not the bundle:
- Each `yield` → engine writes to `.data.jsonl`, checks `AbortSignal`, handles pause/resume
- `return` → engine writes the final result, marks thread complete
- **Fork** = read historical steps from `.data.jsonl`, pass as `input.steps` to a new generator
- **Zero injection** — the bundle doesn't import or receive anything from the engine

### Fork/Resume via ThreadInput

When using the `createRoleModerator` helper, fork is **naturally handled**:

```typescript
// The moderator receives ThreadContext with historical steps
// It sees planner already ran → routes to coder automatically
const gen = workflow(
  { prompt: "fix bug #3", steps: [{ role: "planner", content: "...", meta: {} }] },
  { isDryRun: false, maxRounds: 10 }
);
// First yield will be coder's output, not planner's
```

No special replay logic needed — the moderator/role pattern inherently supports
resuming from any snapshot, because moderator routing is a pure function of the
accumulated steps.

This follows the **Dependency Inversion Principle**: the engine depends on the
generator protocol (a language primitive), not on a framework-specific `WorkflowDefinition`.
Bundles remain pure functions with no coupling to `@uncaged/workflow`.

### Relationship to Role/Moderator Pattern

The Role + Moderator pattern from Section 8 is one **implementation strategy** inside a
bundle, not the bundle contract itself. A helper like `createRoleModerator(roles, moderator)`
can produce the AsyncGenerator internally, but simple workflows can yield directly without
any framework types.

### Constraints

- Single `.esm.js` file
- Named exports `run` (callable AsyncGenerator workflow) and `descriptor` (metadata object)
- No default export
- No dynamic `import()`
- All static imports must be Node built-in modules only

This guarantees the file is self-contained, and its **XXH64 hash** (encoded as Crockford Base32) serves as a globally unique version identifier.

### Role Descriptor (`export const descriptor`)

The bundle **must** export a `descriptor` object describing roles for tooling/agent consumption.

Shape: `{ description: string, roles: Record<string, { description: string, schema: JSONSchema }> }`

When you register a bundle via `uncaged-workflow add`, the engine imports the module, validates `descriptor`, and writes `{hash}.yaml` next to `{hash}.esm.js` under `bundles/` (same serialized shape as below):

```yaml
description: "Workflow brief introduction"
roles:
  planner:
    description: "Analyzes the issue and creates a plan"
    schema:
      type: object
      properties:
        plan:
          type: string
        files:
          type: array
          items:
            type: string
  coder:
    description: "Implements the plan"
    schema:
      type: object
      properties:
        diff:
          type: string
```

Execution uses `run` only; YAML is for tooling and introspection.

## 3. Storage Layout

All data lives under `~/.uncaged/workflow/`:

```
~/.uncaged/workflow/
├── bundles/                              # ESM bundles
│   ├── C9NMV6V2TQT81.esm.js             # Crockford Base32 of XXH64 hash
│   └── C9NMV6V2TQT81.yaml               # Role descriptor (from bundle export, at register time)
├── logs/                                 # Thread data, one folder per bundle hash
│   └── C9NMV6V2TQT81/
│       ├── 01KQXKW18CT8G75T53R8F4G7YG.data.jsonl
│       └── 01KQXKW18CT8G75T53R8F4G7YG.info.jsonl
└── workflow.yaml                         # Registry
```

**Not** a git repo. **Not** an npm package. Bundles are self-contained single files.

### ID Encoding

All IDs use **Crockford Base32**:
- Better readability than Base64
- Higher density than hex (shorter filenames)
- ULID: 10 chars timestamp (high 2 bits zero-padded for future use) + 16 chars random

## 4. Registry (`workflow.yaml`)

```yaml
workflows:
  solve-issue:
    hash: "C9NMV6V2TQT81"
    timestamp: 1714963200000
    history:
      - hash: "A7BKR3M1NPQ40"
        timestamp: 1714876800000
      - hash: "X2FGH8J4KLM56"
        timestamp: 1714790400000
```

Type:

```typescript
{
  workflows: Record<string, {
    hash: string;           // Crockford Base32 of current XXH64
    timestamp: number;
    history: { hash: string; timestamp: number }[];
  }>
}
```

No concurrency control or timeout settings in the registry — those belong to each workflow/role/adapter.

## 5. Thread JSONL Format

### `.data.jsonl` — Thread State

**Line 1: Start record**

```jsonc
{
  "name": "solve-issue",
  "hash": "C9NMV6V2TQT81",
  "threadId": "01KQXKW18CT8G75T53R8F4G7YG",
  "parameters": {
    "prompt": "Fix the login redirect bug in #3",
    "options": {
      "isDryRun": false,
      "maxRounds": 5
    }
  },
  "timestamp": 1714963200000
}
```

**Line 2+: Role outputs**

```jsonc
{
  "role": "planner",
  "content": "Plan: modify auth middleware...",
  "meta": { "plan": "...", "files": ["src/auth.ts"] },
  "timestamp": 1714963201000
}
```

### `.info.jsonl` — Debug Log

```jsonc
{
  "tag": "4KNMR2PX",       // 40-bit random, Crockford Base32 (8 chars)
  "content": "Loading workflow bundle...",
  "timestamp": 1714963200500
}
```

## 6. Execution Model

- **No daemon.** `uncaged-workflow run <name>` starts a worker process.
- Same bundle's threads share one process (memory efficiency).
- Process exits automatically when all threads complete.
- Thread termination requires **IPC** within the process (not just kill PID).

## 7. CLI Requirements

### P1 (Must Have)

| Command | Description |
|---------|-------------|
| `uncaged-workflow add <name> <file.esm.js> [--types <path>]` | Register a compiled `.esm.js` bundle (descriptor extracted from `export const descriptor`) |
| `uncaged-workflow list` | List registered workflows |
| `uncaged-workflow show <name>` | Show workflow details |
| `uncaged-workflow remove <name>` | Remove a workflow |
| `uncaged-workflow run <name> [--prompt] [--dry-run] [--max-rounds]` | Start a thread |
| `uncaged-workflow threads [name]` | List threads (optionally filter by workflow) |
| `uncaged-workflow thread <id>` | Show thread state |
| `uncaged-workflow thread rm <id>` | Delete a thread |
| `uncaged-workflow ps` | List running threads |
| `uncaged-workflow kill <thread-id>` | Terminate a running thread (via IPC) |

### P2 (Should Have)

| Command | Description |
|---------|-------------|
| `uncaged-workflow history <name>` | Show version history |
| `uncaged-workflow rollback <name> [hash]` | Switch to a previous version |
| `uncaged-workflow pause <thread-id>` | Pause a running thread |
| `uncaged-workflow resume <thread-id>` | Resume a paused thread |

### P3 (Nice to Have)

| Command | Description |
|---------|-------------|
| `uncaged-workflow fork <thread-id> [--from-role <role>]` | Fork from a historical thread state |

## 8. Role/Moderator Pattern (Helper, Not Contract)

The bundle contract is the AsyncGenerator from Section 2. The Role + Moderator pattern
below is a **convenience helper** for the common case of multi-role workflows with a
routing function. It lives in `@uncaged/workflow` as an optional utility.

### Helper Function

```typescript
function createRoleModerator<M extends RoleMeta>(
  def: { roles: { [K in keyof M & string]: Role<M[K]> }; moderator: Moderator<M> }
): WorkflowFn;  // returns (input: ThreadInput, options) => AsyncGenerator
```

Usage in a bundle:

```typescript
import { createRoleModerator, END } from "@uncaged/workflow";

export const descriptor = {
  description: "Example multi-role workflow",
  roles: {
    planner: { description: "Plans work", schema: {} },
    coder: { description: "Writes code", schema: {} },
  },
};

export const run = createRoleModerator({
  roles: { planner, coder },
  moderator(ctx) { return ctx.steps.length === 0 ? "planner" : END; },
});
// Accepts ThreadInput — fork with pre-filled steps works automatically
```

### Supporting Types

```typescript
/** Sentinel values for automaton control flow. */
const START = "__start__" as const;
const END = "__end__" as const;

/** Maps role names → their meta types. Single generic drives all inference. */
type RoleMeta = Record<string, Record<string, unknown>>;

/** Typed output of a Role execution. */
type RoleResult<Meta> = { content: string; meta: Meta };

/** Engine start frame: initial prompt + thread identity. */
type StartStep = {
  role: START;
  content: string;              // the user prompt
  meta: { maxRounds: number; threadId: string };
  timestamp: number;
};

/** A completed role step in the thread. */
type RoleStep<M extends RoleMeta> = {
  [K in keyof M & string]: { role: K; meta: M[K]; content: string; timestamp: number };
}[keyof M & string];

/** Thread-scoped context passed to roles and moderator. */
type ThreadContext<M extends RoleMeta = RoleMeta> = {
  threadId: string;
  start: StartStep;
  steps: RoleStep<M>[];
};

/**
 * A Role — receives full thread context, returns typed content + meta.
 * Implementation can be an agent, LLM call, script, HTTP request, etc.
 */
type Role<Meta> = (ctx: ThreadContext) => Promise<RoleResult<Meta>>;

/**
 * An Agent — raw string output interface for LLM/CLI adapters.
 * Structured meta is extracted by the role's extract layer.
 */
type AgentFn = (ctx: ThreadContext, systemPrompt: string) => Promise<string>;

/**
 * The Moderator — a pure routing function.
 * Receives the full thread context (start + all prior steps).
 * On initial call, `steps` is empty.
 * Returns the next role name or END to terminate.
 */
type Moderator<M extends RoleMeta> = (ctx: ThreadContext<M>) => (keyof M & string) | END;

/** Complete workflow definition as authored by users. */
type WorkflowDefinition<M extends RoleMeta> = {
  name: string;
  roles: { [K in keyof M & string]: Role<M[K]> };
  moderator: Moderator<M>;
};
```

### Execution Flow (when using createRoleModerator)

```
START (prompt) → Moderator → Role A → Moderator → Role B → ... → Moderator → END
```

1. Engine creates a `StartStep` with the user prompt and maxRounds
2. Moderator is called with `steps = []`, returns the first role name
3. Role executes, appends a `RoleStep` to the thread
4. Moderator is called again with updated steps, returns next role or END
5. Repeat until END or maxRounds reached

### Responsibilities

| Component | Responsibility | Purity |
|-----------|---------------|--------|
| **Moderator** | Route to next role based on thread state | Pure function, no side effects |
| **Role** | Execute a step (call LLM, run script, etc.) | Async, may have side effects |
| **AgentFn** | Low-level LLM/CLI invocation adapter | Async, side effects |

### Key Constraints

- Moderator is **synchronous and pure** — no I/O, no state mutation
- Roles receive the **full thread context** (not just the last message)
- Round count = `steps.length`; max rounds in `start.meta.maxRounds`
- The `meta` field on each step is **typed per role** via the `RoleMeta` generic

## 9. Design Decisions & Rationale

### Why single-file ESM?
- Hash = version. No ambiguity.
- No dependency hell. Self-contained.
- Simple to distribute, store, and verify.

### Why no daemon?
- Unnecessary complexity for process-per-bundle model.
- OS process management (systemd, etc.) handles restarts.
- IPC within process handles thread lifecycle.

### Why Crockford Base32?
- Case-insensitive, filesystem-safe.
- No ambiguous characters (0/O, 1/I/L).
- More compact than hex (13 chars for 64-bit vs 16).

### Why not control concurrency in registry?
- Different workflows have different constraints.
- Same workflow may allow cross-project concurrency but not intra-project.
- Concurrency belongs at workflow/role/adapter level.
