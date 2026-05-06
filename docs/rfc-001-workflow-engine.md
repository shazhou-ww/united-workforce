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

A **Workflow** is a single-file ESM module that default-exports a function:

```typescript
type WorkflowFn = (
  prompt: string,
  options: { isDryRun: boolean; maxRounds: number }
) => Promise<{ returnCode: number; summary: string }>;
```

### Constraints

- Single `.esm.js` file
- No dynamic `import()`
- All static imports must be Node built-in modules only

This guarantees the file is self-contained, and its **XXH64 hash** (encoded as Crockford Base32) serves as a globally unique version identifier.

### Role Descriptor (Optional)

A YAML file alongside the bundle describes roles for tooling/agent consumption:

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

Format: `{ description: string, roles: Record<string, { description: string, schema: JSONSchema }> }`

This file is **not required** for execution.

## 3. Storage Layout

All data lives under `~/.uncaged/workflow/`:

```
~/.uncaged/workflow/
├── bundles/                              # ESM bundles
│   ├── C9NMV6V2TQT81.esm.js             # Crockford Base32 of XXH64 hash
│   └── C9NMV6V2TQT81.yaml               # Role descriptor (optional)
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
| `uncaged-workflow add <name> <file>` | Register a workflow bundle |
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

## 8. Design Decisions & Rationale

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
