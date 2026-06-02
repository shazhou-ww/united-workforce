# Workflow-as-Agent Implementation Plan

> ⚠️ This plan references the pre-split package structure. File paths have changed.

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Enable workflows to invoke other workflows as agents, backed by global CAS and refs tracking.

**Architecture:** Migrate CAS from thread-local to global (`~/.uncaged/workflow/cas/`), add `refs` to RoleStep for GC traceability, then build `workflowAsAgent(name)` factory that resolves workflow name → bundle via registry and spawns a child thread.

**Tech Stack:** TypeScript, Bun, Zod v4, monorepo with `packages/`

**Issue:** https://git.shazhou.work/uncaged/workflow/issues/25

---

## Phase 1: Global CAS Migration

Move CAS storage from `<threadDir>/<threadId>.cas/` to `~/.uncaged/workflow/cas/` (global, content-addressed, immutable). This is a **breaking change** — thread-local `.cas/` directories are abandoned.

### Task 1.1: Add `globalCasDir` helper to `storage-root.ts`

**Objective:** Provide a single function that returns the global CAS directory path.

**Files:**
- Modify: `packages/workflow/src/storage-root.ts`
- Test: `packages/workflow/__tests__/storage-root.test.ts`

**Implementation:**

```typescript
// storage-root.ts — add export
export function getGlobalCasDir(storageRoot?: string): string {
  const root = storageRoot ?? getDefaultWorkflowStorageRoot();
  return join(root, "cas");
}
```

Export from `packages/workflow/src/index.ts`.

### Task 1.2: Update `cmd-cas.ts` to use global CAS

**Objective:** CLI `cas get/put/list/rm` no longer needs threadId for storage location — CAS is global. But keep threadId in CLI for backward compat of planner/coder prompts (they pass threadId).

**Files:**
- Modify: `packages/cli/src/cmd-cas.ts`

**Changes:**
- `resolveCasDir` → use `getGlobalCasDir(storageRoot)` instead of deriving from thread data path
- `cmdCasPut` / `cmdCasGet` / `cmdCasList` / `cmdCasRm`: threadId is still accepted (prompts pass it) but storage goes to global dir
- Remove the `resolveThreadDataPath` dependency for CAS operations — thread doesn't need to exist to read CAS

```typescript
import { createThreadCas, getGlobalCasDir } from "@uncaged/workflow";

export async function cmdCasGet(
  storageRoot: string,
  _threadId: string, // kept for CLI compat, not used for path
  hash: string,
): Promise<Result<string, string>> {
  const cas = createThreadCas(getGlobalCasDir(storageRoot));
  const content = await cas.get(hash);
  if (content === null) {
    return err(`cas entry not found: ${hash}`);
  }
  return ok(content);
}
// ... same pattern for put/list/rm
```

### Task 1.3: Update `cmd-thread.ts` — thread rm no longer deletes `.cas/`

**Objective:** Since CAS is global, `thread rm` should NOT delete CAS entries. CAS cleanup is GC's job.

**Files:**
- Modify: `packages/cli/src/cmd-thread.ts`
- Check: remove any `rmdir` / `unlink` of `<threadId>.cas/` directory

### Task 1.4: Rename `createThreadCas` → `createCasStore`

**Objective:** The name `createThreadCas` is misleading now. Rename to `createCasStore`.

**Files:**
- Modify: `packages/workflow/src/cas.ts` — rename function
- Modify: `packages/workflow/src/index.ts` — update export (keep `createThreadCas` as deprecated alias for one release)
- Modify: all consumers (`cmd-cas.ts`)

### Task 1.5: Update tests

**Objective:** All CAS-related tests use global dir instead of thread-local.

**Files:**
- Modify: `packages/cli/__tests__/commands.test.ts`
- Verify: `bun test` passes

### Task 1.6: Clean up old thread-local `.cas/` references

**Objective:** Remove dead code that creates/reads thread-local `.cas/` directories.

**Files:**
- Search all `*.ts` for `.cas` path construction patterns
- Remove orphaned helpers

---

## Phase 2: RoleStep `refs` Tracking

Add `refs: string[]` to persisted role steps so GC can trace which CAS entries are alive.

### Task 2.1: Add `refs` to `RoleOutput` and engine persistence

**Objective:** Every role step can declare which CAS hashes it produced or consumed.

**Files:**
- Modify: `packages/workflow/src/types.ts`
- Modify: `packages/workflow/src/engine.ts`

**Changes to `types.ts`:**

```typescript
export type RoleOutput = {
  role: string;
  content: string;
  meta: Record<string, unknown>;
  refs: string[];  // CAS hashes produced/consumed by this step
};
```

**Changes to `engine.ts`:**
- `appendDataLine` for role steps: include `refs` field (default `[]` if not provided)

### Task 2.2: Auto-populate refs from meta hashes

**Objective:** The engine should automatically extract CAS hashes from `meta` to populate `refs`, so roles don't need to manually track them.

**Strategy:** After meta extraction, walk the meta object and collect any string that looks like a CAS hash (Crockford Base32, 13 chars). This is a heuristic but works because CAS hashes are distinctive.

Alternative (simpler): Let each `RoleDefinition` optionally declare a `extractRefs(meta: M) => string[]` function. For planner, this returns `meta.phases.map(p => p.hash)`. For coder, `[meta.completedPhase]`.

**Recommended:** The explicit `extractRefs` approach — no magic, no false positives.

**Files:**
- Modify: `packages/workflow/src/types.ts` — add optional `extractRefs` to `RoleDefinition`
- Modify: `packages/workflow/src/create-workflow.ts` — call `extractRefs` after meta extraction, set on `RoleOutput.refs`
- Modify: `packages/workflow-role-planner/src/planner.ts` — implement `extractRefs`
- Modify: `packages/workflow-role-coder/src/coder.ts` — implement `extractRefs`

```typescript
// types.ts — RoleDefinition addition
export type RoleDefinition<Meta extends Record<string, unknown>> = {
  description: string;
  systemPrompt: string;
  extractPrompt: string;
  schema: z.ZodType<Meta>;
  extractRefs?: (meta: Meta) => string[];  // CAS hashes to track
};

// planner.ts
extractRefs: (meta) => meta.phases.map(p => p.hash),

// coder.ts
extractRefs: (meta) => [meta.completedPhase],
```

### Task 2.3: Update fork logic to preserve refs

**Objective:** When forking a thread, `refs` from historical steps must be carried over.

**Files:**
- Modify: `packages/workflow/src/fork-thread.ts`
- Verify: `ForkHistoricalStep` / `PrefilledDiskStep` include `refs`

### Task 2.4: Tests for refs tracking

**Files:**
- Add: `packages/workflow/__tests__/refs-tracking.test.ts`
- Verify: refs appear in `.data.jsonl` output

---

## Phase 3: CAS Garbage Collection

### Task 3.1: Implement `gc.ts` in `@uncaged/workflow`

**Objective:** Mark-and-sweep GC — scan all thread `.data.jsonl` files, collect `refs`, delete orphaned CAS entries.

**Files:**
- Create: `packages/workflow/src/gc.ts`
- Export from: `packages/workflow/src/index.ts`

```typescript
export type GcResult = {
  scannedThreads: number;
  activeRefs: number;
  deletedEntries: number;
  deletedHashes: string[];
};

export async function garbageCollectCas(storageRoot: string): Promise<GcResult> {
  // 1. Find all .data.jsonl files under storageRoot
  // 2. Parse each, flatMap step.refs → Set<string>
  // 3. List all CAS entries via createCasStore(globalCasDir).list()
  // 4. Delete entries not in active set
  // 5. Return stats
}
```

### Task 3.2: Add `uncaged-workflow gc` CLI command

**Files:**
- Create: `packages/cli/src/cmd-gc.ts`
- Modify: `packages/cli/src/cli-dispatch.ts` — add `gc` subcommand

### Task 3.3: Run GC on `thread rm`

**Files:**
- Modify: `packages/cli/src/cmd-thread.ts` — after deleting thread data, optionally run GC

### Task 3.4: Tests for GC

**Files:**
- Create: `packages/cli/__tests__/gc-cli.test.ts`

---

## Phase 4: `workflowAsAgent` Factory

### Task 4.1: Create `workflowAsAgent` in `@uncaged/workflow`

**Objective:** Factory function that takes a workflow name, resolves to bundle, returns an `AgentFn`.

**Files:**
- Create: `packages/workflow/src/workflow-as-agent.ts`
- Export from: `packages/workflow/src/index.ts`

```typescript
import type { AgentFn } from "./types.js";

export type WorkflowAsAgentOptions = {
  storageRoot?: string;
};

export function workflowAsAgent(
  workflowName: string,
  options?: WorkflowAsAgentOptions,
): AgentFn {
  return async (ctx) => {
    const storageRoot = options?.storageRoot ?? getDefaultWorkflowStorageRoot();

    // 1. Read registry → resolve name to bundle hash + path
    const registry = await readWorkflowRegistry(storageRoot);
    const entry = getRegisteredWorkflow(registry, workflowName);
    if (entry === null) {
      return `ERROR: workflow "${workflowName}" not found in registry`;
    }

    // 2. Load bundle
    const bundlePath = join(storageRoot, "bundles", `${entry.hash}.esm.js`);
    const bundleExports = await extractBundleExports(bundlePath);

    // 3. Create child thread input from ctx.start.content (parent prompt)
    const input: ThreadInput = {
      prompt: ctx.start.content,
      steps: [],
    };

    // 4. Generate child threadId
    const childThreadId = generateUlid();

    // 5. Execute — collect all yields, return final content
    const io: ExecuteThreadIo = { ... };
    const result = await executeThread(bundleExports.run, workflowName, input, ...);

    // 6. Return summary as agent content
    return result.summary;
  };
}
```

### Task 4.2: System-level depth limit

**Objective:** Prevent infinite recursion. Track depth via thread metadata, enforce a global max (default 3, configurable in `workflow.yaml`).

**Files:**
- Modify: `packages/workflow/src/types.ts` — add `depth` to `WorkflowFnOptions`
- Modify: `packages/workflow/src/workflow-as-agent.ts` — increment depth, check limit
- Modify: registry or config types for `maxDepth` setting

### Task 4.3: Tests for workflowAsAgent

**Files:**
- Create: `packages/workflow/__tests__/workflow-as-agent.test.ts`
- Test: name resolution, depth limit, child thread execution

### Task 4.4: Integration test — nested workflow

**Objective:** Create a minimal test workflow that calls another workflow via `workflowAsAgent`.

**Files:**
- Create: `packages/workflow/__tests__/workflow-as-agent-integration.test.ts`

---

## Execution Order

```
Phase 1 (Global CAS) → Phase 2 (refs) → Phase 3 (GC) → Phase 4 (workflowAsAgent)
```

Each phase is independently mergeable. Phase 3 depends on Phase 2 (needs refs to know what's alive). Phase 4 depends on Phase 1 (global CAS for cross-thread sharing).

## Breaking Changes

- CAS storage location moves from `<thread>.cas/` to `~/.uncaged/workflow/cas/`
- `RoleOutput` gains required `refs: string[]` field
- Existing threads with thread-local CAS will lose access to old CAS data (acceptable — those are short-lived workflow artifacts)
- `createThreadCas` renamed to `createCasStore` (alias kept temporarily)
