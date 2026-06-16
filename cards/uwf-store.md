---
id: uwf-store
title: "The uwf Store wrapper (UwfStore + createUwfStore)"
sources:
  - packages/cli/src/store.ts
  - packages/cli/src/schemas.ts
  - ~/repos/ocas/packages/core/src/types.ts
tags: [architecture, store, ocas, variables, migrations, workflow-discovery, realtime-turns]
created: 2026-06-16
updated: 2026-06-16
---

# The uwf Store wrapper (UwfStore + createUwfStore)

`store.ts` is the CLI's single entry point to persistent state. It wraps an
**ocas `Store`** (`{ cas, var, tag }`) plus the registered uwf schema hashes,
and layers the uwf-specific concerns on top: the `@uwf/*` variable namespace,
the workflow registry, the threads index, one-time migrations, and project
workflow discovery.

```ts
export type UwfStore = {
  storageRoot: string;       // per-user metadata root (~/.uwf or $UWF_HOME)
  store: Store;              // ocas aggregate { cas, var, tag }
  schemas: UwfSchemaHashes;  // registered schema hashes (from schemas.ts)
  varStore: VarStore;        // === store.var, surfaced for convenience
};
```

## `createUwfStore(storageRoot)` — assembly order

`createUwfStore` (lines 233–246) builds the store in a fixed order:

1. **CAS dir** — `getGlobalCasDir()` (NOT `storageRoot`); `mkdir -p`.
2. **CAS store** — `createFsStore(casDir)` from `@ocas/fs`.
3. **Var + tag stores** — `createSqliteVarStore(join(casDir, "vars"), cas)`
   returns `{ var, tag }`; the SQLite DB lives at `<casDir>/vars`, **inside**
   the global CAS dir (not under `storageRoot`).
4. **Aggregate** — `const store: Store = { cas, var: varStore, tag }`.
5. **`bootstrap(store)`** — registers the ocas base schemas (`@ocas/string`,
   etc.) and returns their aliases.
6. **`registerUwfSchemas(store)`** — see schemas.ts below; returns
   `UwfSchemaHashes`.
7. **Migrations** (run every CLI invocation, each a no-op once done):
   `migrateWorkflowRegistryIfNeeded` → `migrateThreadsIndexIfNeeded` →
   `migrateHistoryIfNeeded` → `migrateHistoryVarsToThreadVars`.

Key takeaway: **content** (CAS) and **per-user metadata** (`storageRoot`) are
separated, but the var/tag SQLite store currently lives under the *CAS* dir
(`<OCAS_HOME>/vars`), so variables are shared by every tool pointing at the
same `OCAS_HOME`.

## Storage-root vs CAS-dir resolution

Two independent roots, each with its own env override:

| Function | Env → default | Holds |
|----------|---------------|-------|
| `resolveStorageRoot()` | `UWF_HOME` → `~/.uwf` | per-user uwf metadata (legacy YAML pre-migration; `getRegistryPath`/`getThreadsPath` point here) |
| `getGlobalCasDir()` | `OCAS_HOME` → `~/.ocas` | the shared content store (CAS + `vars/` SQLite) |
| `getCasDir(storageRoot)` | — (`<root>/cas`) | **deprecated**; superseded by `getGlobalCasDir()` |

`getDefaultStorageRoot()` returns `join(homedir(), ".uwf")`. Both env vars are
treated as unset when undefined **or empty string**.

## The `@uwf/*` variable namespace

State that used to live in YAML/JSONL files is now stored as ocas **variables**
(name → hash, with optional tags). Three prefixes:

- `REGISTRY_VAR_PREFIX = "@uwf/registry/"` → `@uwf/registry/<name>` per workflow.
- `THREAD_VAR_PREFIX = "@uwf/thread/"` → `@uwf/thread/<thread-id>` per thread
  (active **and** history; status distinguishes them).
- `@uwf/thread-failed/<thread-id>/*` → retry-lineage scratch state, cleared on
  completion via `clearThreadFailedAttempts`.

A legacy `@uwf/history/*` prefix is migrated away (see migrations).

## Workflow registry as variables

The registry is a `Record<name, CasRef>` projected over the variable store:

- `loadWorkflowRegistry(varStore)` — `varStore.list({ namePrefix:
  REGISTRY_VAR_PREFIX })`, stripping the prefix to recover each name.
- `saveWorkflowRegistry(varStore, name, hash)` — `varStore.set(
  "@uwf/registry/" + name, hash)`.
- `resolveWorkflowHash(registry, id)` — returns `registry[id]` if present,
  else `id` verbatim (so a raw CAS hash passes through unchanged).
- `findRegistryName(registry, hash)` — reverse lookup hash → name.

## Threads index as variables (status encoded in tags)

Each thread is one variable: **value = head CAS ref**, and the non-default
fields of `ThreadIndexEntry` are stored as **tags**:

- `setThread(varStore, threadId, entry)` (lines 394–412) — `remove`s the var
  first (head may switch between `StartNode`/`StepNode` schemas), then `set`s
  `head` with tags. Tags are written **only when non-default**: `status`
  (omitted when `"idle"`), `suspendedRole`, `suspendMessage`, `completedAt`
  (stringified number).
- `entryFromVariable(v)` (lines 362–370) — inverse: `status` defaults to
  `"idle"`, `suspendedRole`/`suspendMessage` default to `null`, `completedAt`
  is `Number(...)` or `null`.
- `getThread` — `varStore.list({ exactName })`, first match or `null`.
- `loadAllThreads` — every `@uwf/thread/*` var → `ThreadsIndex`.
- `loadActiveThreads` / `loadHistoryThreads` — partition `loadAllThreads` by
  status: history = `status === "end" || "cancelled"`; active = everything else.
- `completeThread(varStore, threadId, "end"|"cancelled")` — re-`setThread`s
  with the terminal status + `completedAt = Date.now()` (clearing
  suspend fields), then `clearThreadFailedAttempts`.

So the "active threads" and "history" lists are two **views** over the same
variable prefix, distinguished entirely by the `status` tag — there is no
separate history store.

## One-time migrations (each renames source to `.migrated`)

All four run on every `createUwfStore` but short-circuit once their source is
gone:

1. `migrateWorkflowRegistryIfNeeded` — `~/.uwf/workflows.yaml` →
   `@uwf/registry/*` vars, then `rename(path, path + ".migrated")`.
2. `migrateThreadsIndexIfNeeded` — `~/.uwf/threads.yaml` → `@uwf/thread/*`
   vars via `setThread`, then `.migrated`.
3. `migrateHistoryIfNeeded` — `~/.uwf/history.jsonl` (one JSON object per line,
   parsed by `parseLegacyHistoryJsonlLine`) → `@uwf/thread/*` vars; `reason ===
   "cancelled"` maps to `status "cancelled"`, otherwise `"end"`; then
   `.migrated`.
4. `migrateHistoryVarsToThreadVars` — in-store move of legacy
   `@uwf/history/*` vars → `@uwf/thread/*` vars (status from the `reason` tag),
   `remove`-ing each old var. This one is synchronous and var-only (no file).

The first three guard on `existsSync(path)`; renaming to `.migrated` makes them
idempotent across runs.

## Project workflow discovery (cwd-upward)

Independent of the variable-backed registry, the CLI also finds workflows from
the filesystem:

- `scanWorkflowDir(dir)` — lists a single directory: flat `*.yaml`/`*.yml`
  files (name = filename stem via `stemFromYaml`) **plus** subdirectories
  containing an `index.yaml`/`index.yml` (`findIndexWorkflow`). Missing dir
  (`ENOENT`/`ENOTDIR`) → `[]`.
- `discoverProjectWorkflows(startDir)` — walks **from `startDir` upward**. At
  each level it scans `.workflows/` (primary) and `.workflow/` (legacy); the
  **first** level with any match wins (ancestors are not merged in).
  `mergeWorkflowEntries` lets primary entries win name collisions over legacy.
  Traversal stops at the first `.git` marker (`hasGitMarker`, dir *or* file) or
  the filesystem root. This mirrors `findWorkflowInParents` used by `uwf thread
  start`, so `workflow list` and `thread start` agree on what is resolvable.
- `discoverWorkflowPathsEntries(dirs)` — scans an explicit list of dirs;
  earlier dirs win on name collision (no upward walk).
- `resolveProjectWorkflowFile(localEntries, name)` — linear lookup name → path.

## schemas.ts — the registered schema hashes (tight collaborator)

`createUwfStore` calls `registerUwfSchemas(store)` (in `schemas.ts`), which
returns `UwfSchemaHashes`:

```ts
type UwfSchemaHashes = {
  workflow; startNode; stepNode; text;       // core node schemas
  errorOutput; suspendOutput;                // reserved output schemas
  outputs: Record<OutputSchemaName, Hash>;   // the 9 CLI output envelopes
};
```

- The six core schemas are registered in parallel via `putSchema` (lines
  33–40). `TEXT_SCHEMA = { type: "string" }` is the schema `broker-step.ts`
  uses to store the assembled prompt as `schemas.text`.
- `registerOutputSchemas` registers each `@uwf/output/<name>` schema (binding
  `outputSchemaVarName(name)` → schema hash) and stores its Liquid template as
  an `@ocas/string` CAS node, binding `@ocas/template/text/<schemaHash>` →
  content hash.
- Everything is **content-addressed and idempotent** — re-running on every CLI
  invocation no-ops. `bootstrap(store)` is called here too (for the
  `@ocas/string` alias) and again in `createUwfStore`; both are idempotent.

These hashes are what `broker-step.ts` and `step.ts` reference as
`uwf.schemas.stepNode` / `.text` / `.errorOutput` / `.suspendOutput`.

## ocas core type contracts (source of truth)

The shapes of `Store`, `VarStore`, `CasStore`, `TagStore`, and `Hash` are
**defined in `~/repos/ocas/packages/core/src/types.ts`** — consult that file
rather than re-deriving them. Relevant for this card:

- `Hash` — a 13-char uppercase Crockford Base32 string (XXH64).
- `Store = { cas: CasStore; var: VarStore; tag: TagStore }` — exactly what
  `createUwfStore` assembles.
- `CasStore` — synchronous `get/put/has/delete/listByType/listMeta/
  listSchemas/listAll`.
- `VarStore` — `set/get/remove/update/list/history/close`; `set`/`update` take
  `VarSetOptions { tags?, labels? }` (the `tags` channel `setThread` uses), and
  `list` takes `VarListOptions { namePrefix?, exactName?, schema?, tags?,
  labels? }` (the `namePrefix`/`exactName` filters this module relies on).
- `TagStore` — `tag/untag/tags/listByTag` (uwf encodes thread status as
  variable tags rather than CAS tags, but the contract lives here).

> Note: ocas `CasStore.put` is **synchronous**, but `store.ts` `await`s several
> CAS/var writes (e.g. through `registerUwfSchemas`). Treat the precise
> sync/async surface as defined by the ocas types; this card documents the uwf
> wrapper's behavior, not ocas internals.

## Cross-links

- **`broker-step-execution`** — writes turn/detail/StepNode triplets through
  this store's `cas`, and the assembled prompt through `schemas.text`.
- **`step-commands`** — reads back the StepNode chain and `@uwf/thread/*` vars
  (e.g. `cmdStepFork` mints a new idle thread var here).
