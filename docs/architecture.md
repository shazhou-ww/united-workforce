# @uncaged/workflow — Architecture

**Last updated:** 2026-05-06 by 小橘 🍊（NEKO Team）

---

## Overview

A workflow engine that executes single-file ESM bundles. Each workflow is a self-contained `.esm.js` file identified by its XXH64 hash (Crockford Base32). No daemon — processes start on demand and exit when done.

## Package Structure

| Package | npm Name | Purpose |
|---------|----------|---------|
| `workflow` | `@uncaged/workflow` | Core: types, engine, ExtractFn, hash/ULID/registry |
| `cli-workflow` | `@uncaged/cli-workflow` | CLI: `uncaged-workflow` command |
| `workflow-agent-cursor` | `@uncaged/workflow-agent-cursor` | Cursor CLI agent (extracts workspace from ctx) |
| `workflow-agent-hermes` | `@uncaged/workflow-agent-hermes` | Hermes CLI agent |
| `workflow-agent-llm` | `@uncaged/workflow-agent-llm` | OpenAI-compatible LLM agent |
| `workflow-template-develop` | `@uncaged/workflow-template-develop` | Develop workflow template (roles in `src/roles/`) |
| `workflow-template-solve-issue` | `@uncaged/workflow-template-solve-issue` | Solve-issue workflow template (roles in `src/roles/`) |
| `workflow-util-agent` | `@uncaged/workflow-util-agent` | `buildAgentPrompt` + `spawnCli` utilities |

Monorepo with **bun workspace**, `workspace:*` protocol.

## Core Types

```typescript
// --- Sentinel values ---
const START = "__start__";
const END = "__end__";

// --- RoleMeta: maps role names → their meta types ---
type RoleMeta = Record<string, Record<string, unknown>>;

// --- Role Definition: pure data, no execution logic ---
type RoleDefinition<Meta> = {
  description: string;      // human-readable
  systemPrompt: string;     // given to agent
  extractPrompt: string;    // given to extractor
  schema: z.ZodType<Meta>;  // meta shape (Zod v4)
};

// --- Workflow Definition: pure data, no agent binding ---
type WorkflowDefinition<M extends RoleMeta> = {
  description: string;
  roles: { [K in keyof M & string]: RoleDefinition<M[K]> };
  moderator: Moderator<M>;
};

// --- Agent: raw string output, reads role info from context ---
type AgentFn = (ctx: AgentContext) => Promise<string>;

// --- Agent Binding: runtime assignment ---
type AgentBinding = {
  agent: AgentFn;
  overrides?: Partial<Record<string, AgentFn>>;
};

// --- Extract: structured data from context ---
type ExtractFn = <T>(schema: z.ZodType<T>, prompt: string, ctx: ExtractContext) => Promise<T>;

// --- Moderator: pure routing function ---
type Moderator<M extends RoleMeta> = (ctx: ModeratorContext<M>) => (keyof M & string) | typeof END;

// --- Composition ---
// createWorkflow(def, binding, extract) => WorkflowFn
```

## Three-Phase Engine Loop

Each role execution has three distinct phases with progressive context:

```
┌─→ Phase 1: MODERATOR
│   Context: ModeratorContext { threadId, start, steps }
│   Action:  moderator(ctx) → role name | END
│
│   Phase 2: AGENT
│   Context: AgentContext = ModeratorCtx + { currentRole: { name, systemPrompt } }
│   Action:  agent(ctx) → raw string
│
│   Phase 3: EXTRACTOR
│   Context: ExtractContext = AgentCtx + { agentContent }
│   Action:  extract(schema, extractPrompt, ctx) → typed meta
│
│   Merge: RoleStep { role, content, meta, timestamp }
│   Append to steps
└─────────────────────────────────────────────────────┘
```

### Context Types (progressive)

```typescript
// Phase 1: Moderator sees accumulated state only
type ModeratorContext<M> = {
  threadId: string;
  start: StartStep;
  steps: RoleStep<M>[];
};

// Phase 2: Agent knows its identity
type AgentContext<M> = ModeratorContext<M> & {
  currentRole: { name: string; systemPrompt: string };
};

// Phase 3: Extractor has agent output
type ExtractContext<M> = AgentContext<M> & {
  agentContent: string;
};

// ThreadContext is an alias for AgentContext (backward compat)
type ThreadContext<M> = AgentContext<M>;
```

### Key Properties

- **Moderator is synchronous and pure** — no I/O, no state mutation
- **Agent gets context, not instructions** — reads `ctx.currentRole.systemPrompt`
- **Extractor is a general tool** — not limited to post-agent extraction; agents can use it too (e.g. Cursor agent extracts workspace path before execution)
- **extractPrompt is a call parameter**, not context state — different callers use different prompts

## Agent Information Sources

An agent has exactly three information sources:

1. **Prior knowledge** — LLM training, agent memory, agent skills
2. **Thread context** — `AgentContext` (start, steps, currentRole)
3. **Derived information** — from 1 & 2 (e.g. tool calls, shell commands)

No hidden environment parameters. If an agent needs something (like a workspace path), it extracts it from context using `ExtractFn`.

## Bundle Contract

A workflow bundle is a single `.esm.js` file with two named exports:

```typescript
// Named exports (no default export)
export const descriptor: WorkflowDescriptor;
export const run: WorkflowFn;

type WorkflowFn = (
  input: { prompt: string; steps: RoleOutput[] },
  options: { threadId: string; maxRounds: number },
) => AsyncGenerator<RoleOutput, WorkflowResult>;
```

### Constraints

- Single `.esm.js` file
- No dynamic `import()`
- All static imports must be Node built-in modules only
- XXH64 hash (Crockford Base32) = globally unique version ID

### Why AsyncGenerator?

- Each `yield` → engine writes to `.data.jsonl`, checks abort/pause
- `return` → engine marks thread complete
- Fork = pass historical steps as `input.steps` to a new generator
- Zero injection — bundle doesn't import from the engine

## Storage Layout

```
~/.uncaged/workflow/
├── bundles/
│   ├── C9NMV6V2TQT81.esm.js     # Crockford Base32 of XXH64
│   └── C9NMV6V2TQT81.yaml       # Role descriptor
├── logs/                          # One folder per bundle hash
│   └── C9NMV6V2TQT81/
│       ├── 01KQXKW…YG.data.jsonl  # Thread state
│       └── 01KQXKW…YG.info.jsonl  # Debug log
└── workflow.yaml                  # Registry
```

### ID Encoding: Crockford Base32

- Case-insensitive, filesystem-safe, no ambiguous chars (0/O, 1/I/L)
- Bundle hash: XXH64 → 13-char
- Thread ID: ULID → 26-char (10 timestamp + 16 random)

### Registry (`workflow.yaml`)

```yaml
workflows:
  solve-issue:
    hash: "C9NMV6V2TQT81"
    timestamp: 1714963200000
    history:
      - hash: "A7BKR3M1NPQ40"
        timestamp: 1714876800000
```

### Thread JSONL

**`.data.jsonl`** — Line 1: start record, Line 2+: role outputs

```jsonc
// Start record
{ "name": "solve-issue", "hash": "C9NMV6V2TQT81", "threadId": "01KQXKW…",
  "parameters": { "prompt": "Fix bug #3", "options": { "maxRounds": 5 } },
  "timestamp": 1714963200000 }
// Role output
{ "role": "planner", "content": "...", "meta": { "phases": [...] }, "timestamp": ... }
```

**`.info.jsonl`** — Structured debug log

```jsonc
{ "tag": "4KNMR2PX", "content": "Loading bundle...", "timestamp": ... }
```

Tags are 8-char Crockford Base32 (40-bit random), one per call site. `grep "4KNMR2PX"` → instant code location.

## Execution Model

- **No daemon.** `uncaged-workflow run <name>` starts a worker process
- Same bundle's threads share one process (memory efficiency)
- Process exits when all threads complete
- Thread termination via IPC within the process

## CLI Commands

| Priority | Command | Description |
|----------|---------|-------------|
| P1 | `add <name> <file.esm.js>` | Register a bundle |
| P1 | `list` | List registered workflows |
| P1 | `show <name>` | Show workflow details |
| P1 | `remove <name>` | Remove a workflow |
| P1 | `run <name> [--prompt] [--max-rounds]` | Start a thread |
| P1 | `threads [name]` | List threads |
| P1 | `thread <id>` | Show thread state |
| P1 | `thread rm <id>` | Delete a thread |
| P1 | `ps` | List running threads |
| P1 | `kill <thread-id>` | Terminate a running thread |
| P2 | `history <name>` | Show version history |
| P2 | `rollback <name> [hash]` | Switch to a previous version |
| P2 | `pause <thread-id>` | Pause a running thread |
| P2 | `resume <thread-id>` | Resume a paused thread |
| P3 | `fork <thread-id> [--from-role <role>]` | Fork from historical state |

All commands implemented and tested. ✅

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Role = pure data** | Decouples definition from execution; same role with different agents |
| **Agent bound at runtime** | WorkflowDefinition is reusable; agent choice is deployment concern |
| **Three-phase context** | Each phase sees only what it needs; clean separation |
| **ExtractFn as general tool** | Agents use it for pre-execution extraction; engine uses it for meta |
| **Single-file ESM** | Hash = version, no dependency hell, self-contained |
| **No daemon** | OS handles process lifecycle; unnecessary complexity |
| **Crockford Base32** | Filesystem-safe, readable, compact |
| **No concurrency in registry** | Different workflows have different constraints; belongs at workflow/role level |
| **No dryRun** | Tests use mock agents + mock fetch; simpler architecture |
