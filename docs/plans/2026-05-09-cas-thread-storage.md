# RFC: CAS-Based Thread Storage

> Status: Draft
> Author: 小橘 🍊（NEKO Team）
> Date: 2026-05-09

## Summary

Replace `.data.jsonl` with a fully CAS-based thread state chain. Threads become linked lists of immutable CAS nodes, indexed by a per-bundle `threads.json`.

## Motivation

`.data.jsonl` is a flat append-only file with three different row formats (start, role step, end). This makes forking expensive (copy file), deduplication impossible (forked threads repeat shared history), and GC complex (must parse every row to find CAS refs).

Threads are inherently immutable append-only sequences — a natural fit for CAS hash chains, similar to git's commit DAG.

## Design

### Node Types

Two CAS node types, using the existing `{ type, payload, refs }` CAS blob structure:

#### StartNode

Contains workflow-level parameters. **No threadId** (because the same StartNode can be shared across forks).

```
CAS blob:
{
  type: "start",
  payload: {
    name: "solve-issue",
    hash: "BUNDLE_HASH",
    prompt: "Fix the login redirect bug...",
    maxRounds: 10,
    depth: 0
  },
  refs: []
}
```

- `prompt` is the initial task prompt (stored in CAS, no longer inline in JSONL)
- No `role`, `content`, `meta` — this is not a step, it's workflow metadata

#### StateNode

One per role step (including `__end__`).

```
CAS blob:
{
  type: "state",
  payload: {
    role: "coder",
    meta: { ... },
    timestamp: 1234567890
  },
  refs: [
    <start_hash>,       // refs[0]: always the StartNode
    <parent_hash>,      // refs[1]: previous StateNode (null for first step)
    <content_hash>,     // refs[2]: role output content
    ...ancestors,       // refs[3..N]: skip-list of up to 10 ancestor StateNode hashes
  ]
}
```

**Fixed ref positions:**

| Index | Meaning | Nullable |
|-------|---------|----------|
| 0 | StartNode hash | No |
| 1 | Parent StateNode hash | Yes (null for first step after start) |
| 2 | Content hash (role output) | No |
| 3+ | Ancestor skip-list (≤ 10 most recent ancestors, newest first) | Optional |

**Optional payload fields:**

| Field | Type | Meaning |
|-------|------|---------|
| `compact` | `string \| null` | CAS hash of a compacted summary of all nodes before this one. When present, LLM context assembly can use this instead of walking the full chain. |

### End Node

An end is just a StateNode with `role: "__end__"`:

```
{
  type: "state",
  payload: {
    role: "__end__",
    meta: { returnCode: 0, summary: "completed successfully" },
    timestamp: 1234567891
  },
  refs: [<start_hash>, <parent_hash>, <content_hash>, ...ancestors]
}
```

### Thread Index: `threads.json`

Per-bundle directory, one `threads.json` file:

```
~/.uncaged/workflow/bundles/<hash>/threads.json
```

```json
{
  "01JTHREAD1AAAAAAAAAAAAAAA": {
    "head": "<latest_state_node_hash>",
    "start": "<start_node_hash>",
    "updatedAt": 1234567891
  },
  "01JTHREAD2BBBBBBBBBBBBBBB": {
    "head": "<latest_state_node_hash>",
    "start": "<start_node_hash>",
    "updatedAt": 1234567892
  }
}
```

- Dashboard SSE watches `threads.json` for real-time updates
- `threadId` lives here (not in any CAS node, since CAS nodes are fork-shareable)
- `start` is denormalized for quick access without walking the chain

### Ancestor Skip-List

Each StateNode carries up to 10 ancestor hashes in `refs[3..N]` (newest first):

```
Node 15: refs = [start, node14, content, node13, node12, node11, node10, node9, node8, node7, node6, node5, node4]
                                         ^--- ancestors (10 most recent) ---^
```

This enables:
- **Paginated fetch**: jump to any recent ancestor without walking the full chain
- **Partial replay**: fetch last N steps without loading the entire history
- The list is capped at 10 to keep node size bounded

### Fork

Forking a thread at step N:

1. Create new threadId
2. Create a new StateNode whose `parent` (refs[1]) points to the fork point's StateNode
3. Register the new threadId in `threads.json` with its own head
4. **Zero data duplication** — the forked thread shares all ancestor nodes via CAS

### Compact

When a StateNode has `payload.compact` set:

```json
{
  "type": "state",
  "payload": {
    "role": "coder",
    "meta": { ... },
    "compact": "<cas_hash_of_summary>",
    "timestamp": 1234
  },
  "refs": [...]
}
```

This means: "everything before this node has been summarized into the blob at `compact`". When building LLM context:

1. Walk back from head
2. If a node has `compact`, stop walking — use the compact summary + all nodes after it
3. If no compact found, use full chain

This enables long-running threads without unbounded context growth.

### GC

Simple mark-and-sweep:

1. **Roots**: all `head` and `start` hashes from all `threads.json` files
2. **Mark**: from each root, recursively mark all reachable hashes via `refs[]`
3. **Sweep**: delete unmarked CAS blobs

No per-row format parsing needed. GC only needs to understand `refs[]`.

## What Stays Unchanged

- `.info.jsonl` — debug logging stays as-is (high-frequency append, not suitable for CAS)
- CAS blob storage format (`~/.uncaged/workflow/cas/`)
- Bundle registry (`workflow.yaml`)

## Migration

Breaking change. Old `.data.jsonl` files become incompatible. No backward compat fallback (per project convention).

## Changes by Package

| Package | Changes |
|---------|---------|
| `workflow-protocol` | Replace `StartStep`, `RoleStep` types with `StartNode`, `StateNode`. Remove `refs[]` from step types. |
| `workflow-cas` | Add `findReachableHashes(roots)` for GC mark phase |
| `workflow-execute` | Rewrite engine to write CAS nodes + update `threads.json` instead of appending JSONL. Simplify `gc.ts`. Simplify `fork-thread.ts`. |
| `workflow-runtime` | `ThreadContext` built by walking chain from head. `start.content` resolved from CAS. |
| `cli-workflow` | `thread list/show/rm` read from `threads.json`. SSE watches `threads.json`. |
| `workflow-dashboard` | Watch `threads.json` instead of `.data.jsonl` |
| Templates & Agents | Update `ctx.start.content` → resolved from CAS |
