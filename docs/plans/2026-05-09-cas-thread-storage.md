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

Contains workflow-level parameters. **No threadId** (because the same StartNode can be shared across forks). Prompt is stored as a CAS blob and referenced via `refs[0]`.

```
CAS blob:
{
  type: "start",
  payload: {
    name: "solve-issue",
    hash: "BUNDLE_HASH",
    maxRounds: 10,
    depth: 0
  },
  refs: [
    <prompt_hash>    // refs[0]: initial task prompt (CAS blob)
  ]
}
```

- No `role`, `content`, `meta` — this is not a step, it's workflow metadata
- Prompt is **not** inline — it lives in CAS and is referenced by hash

#### StateNode

One per role step (including `__end__`).

```
CAS blob:
{
  type: "state",
  payload: {
    role: "coder",
    meta: { ... },
    start: "<start_hash>",
    content: "<content_merkle_hash>",
    ancestors: ["<parent_hash>", "<grandparent_hash>", ...],
    compact: null,
    timestamp: 1234567890
  },
  refs: [<start_hash>, <content_hash>, <parent_hash>, ...]
}
```

**Payload is the source of truth.** Application code reads named fields from payload. `refs[]` is a **GC index** — automatically derived from payload by collecting all CAS hashes. GC only scans `refs[]` without understanding payload structure.

**Payload fields:**

| Field | Type | Meaning |
|-------|------|---------|
| `role` | `string` | Role name, or `"__end__"` for completion |
| `meta` | `object` | Structured metadata extracted from agent output |
| `start` | `string` | StartNode hash |
| `content` | `string` | Content Merkle node hash (carries role artifact refs) |
| `ancestors` | `string[]` | `[parent, grandparent, ...]` — up to 11 entries (1 parent + 10 skip-list). Empty for first step after start. `ancestors[0]` is the direct parent. |
| `compact` | `string \| null` | CAS hash of a compacted summary of all nodes before this one. When present, LLM context assembly can use this instead of walking the full chain. |
| `timestamp` | `number` | Unix timestamp in ms |

### Content Merkle Node

The content at `refs[2]` of each StateNode is itself a CAS Merkle node. This is where **role artifact references** live:

```
CAS blob:
{
  type: "content",
  payload: "<role output text>",
  refs: [
    <artifact_hash_1>,   // e.g. a commit, a file, a sub-result
    <artifact_hash_2>,
    ...
  ]
}
```

The Extractor is responsible for producing both `meta` and `refs` from raw agent output:

```
Agent raw output
    ↓
Extractor → { meta, contentPayload, refs[] }
    ↓
CAS put content Merkle: { type: "content", payload: contentPayload, refs }
    ↓ contentHash
StateNode: { ..., refs: [start, parent, contentHash, ...ancestors] }
```

This keeps StateNode refs fixed and simple. All role-specific artifact references are encapsulated in the content Merkle node. GC follows: `thread head → StateNode.refs → content Merkle.refs → artifacts`, full chain recursive.

### End Node

An end is just a StateNode with `role: "__end__"`:

```
{
  type: "state",
  payload: {
    role: "__end__",
    meta: { returnCode: 0, summary: "completed successfully" },
    start: "<start_hash>",
    content: "<content_hash>",
    ancestors: ["<parent_hash>", ...],
    compact: null,
    timestamp: 1234567891
  },
  refs: [<start_hash>, <content_hash>, <parent_hash>, ...]
}
```

### Thread Index: `threads.json`

Per-bundle directory, one `threads.json` file. **Only active (in-progress) threads** live here:

```
~/.uncaged/workflow/bundles/<hash>/threads.json
```

```json
{
  "01JTHREAD1AAAAAAAAAAAAAAA": {
    "head": "<latest_state_node_hash>",
    "start": "<start_node_hash>",
    "updatedAt": 1234567891
  }
}
```

When a thread completes (`__end__`), it is **removed from `threads.json`** and appended to a date-partitioned history file:

```
~/.uncaged/workflow/bundles/<hash>/history/{YYYY-MM-DD}.jsonl
```

Each line:

```json
{"threadId":"01JTHREAD1AAAAAAAAAAAAAAA","head":"<end_node_hash>","start":"<start_node_hash>","completedAt":1234567891}
```

Benefits:
- `threads.json` stays small — only in-flight threads
- Dashboard watches `threads.json` for real-time updates; completed threads don't trigger watches
- History is queryable by date but not actively monitored
- GC roots = all heads from `threads.json` + all heads from `history/*.jsonl`

### Ancestor Skip-List

Each StateNode carries up to 11 entries in `payload.ancestors` (1 parent + 10 skip-list, newest first):

```
Node 15: ancestors = [node14, node13, node12, node11, node10, node9, node8, node7, node6, node5, node4]
                      ^parent  ^--- skip-list (10 most recent) ---^
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

1. **Roots**: all `head` and `start` hashes from `threads.json` + all `history/*.jsonl` files
2. **Mark**: from each root, recursively mark all reachable hashes via `refs[]` (including content Merkle → artifact refs)
3. **Sweep**: delete unmarked CAS blobs

No per-row format parsing needed. GC only needs to understand `refs[]`.

### refs[] Derivation

`refs[]` is auto-derived from payload at write time via a `collectRefs(payload)` function that extracts all CAS hash strings from named fields (`start`, `content`, `ancestors`, `compact`). Application code never reads `refs[]` — it reads named payload fields. This makes `refs[]` a pure GC optimization with zero semantic coupling.

### Extract Phase

The Extractor is expanded from the current design. Currently it only extracts `meta` from agent output. In the new design it extracts:

| Output | Purpose |
|--------|---------|
| `meta` | Structured metadata (same as before) |
| `contentPayload` | The text payload for the content Merkle node |
| `refs[]` | CAS hashes of artifacts produced by this role step |

The `refs[]` become the content Merkle node's refs, enabling GC to trace all role-produced artifacts.

## What Stays Unchanged

- `.info.jsonl` — debug logging stays as-is (high-frequency append, not suitable for CAS)
- CAS blob storage format (`~/.uncaged/workflow/cas/`)
- Bundle registry (`workflow.yaml`)

## Migration

Breaking change. Old `.data.jsonl` files become incompatible. No backward compat fallback (per project convention).

## Changes by Package

| Package | Changes |
|---------|---------|
| `workflow-protocol` | Replace `StartStep`, `RoleStep` types with `StartNode`, `StateNode`. Add `ContentMerkleNode` type. Expand `ExtractResult` to include `refs[]`. |
| `workflow-cas` | Add `findReachableHashes(roots)` for GC mark phase |
| `workflow-execute` | Rewrite engine to write CAS nodes + update `threads.json` instead of appending JSONL. Move completed threads to `history/`. Simplify `gc.ts`. Simplify `fork-thread.ts`. Expand extract phase to produce refs. |
| `workflow-runtime` | `ThreadContext` built by walking chain from head. `start.prompt` resolved from CAS via StartNode.refs[0]. |
| `cli-workflow` | `thread list/show/rm` read from `threads.json` + `history/`. SSE watches `threads.json`. |
| `workflow-dashboard` | Watch `threads.json` instead of `.data.jsonl` |
| Templates & Agents | Update extract definitions to produce `refs[]`. Update `ctx.start.content` → CAS resolved. |
