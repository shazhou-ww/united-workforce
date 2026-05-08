# @uncaged/workflow

Core workflow engine: registry, CAS, thread execution, bundle validation, and role/workflow types.

This package implements the three-phase engine loop that runs single-file ESM workflow bundles (each exports `run` and `descriptor`). It persists threads under `~/.uncaged/workflow/` by default and hashes bundles with XXH64 (Crockford Base32). See the repo root [README](../../README.md) for workflow, bundle, thread, role, and registry concepts.

## Install

```bash
bun add @uncaged/workflow zod
```

In this monorepo, depend with `"@uncaged/workflow": "workspace:*"`. `zod` is a peer dependency (used by bundle/shape validation at the integration boundary).

## Usage

```typescript
import { createWorkflow, readWorkflowRegistry, executeThread } from "@uncaged/workflow";
// Wire a WorkflowDefinition + AgentBinding + extract + optional LlmProvider into createWorkflow,
// then run the returned WorkflowFn inside your host (or use executeThread for disk-backed runs).
```

## API overview

| Area | Exports (representative) |
|------|--------------------------|
| **Types** | `WorkflowDefinition`, `WorkflowFn`, `AgentFn`, `AgentBinding`, `Moderator`, `RoleDefinition`, `ThreadContext`, `LlmProvider`, `Result` shape via `ok` / `err`, `START` / `END` |
| **Bundle** | `buildDescriptor`, `extractBundleExports`, `validateWorkflowBundle`, `validateWorkflowDescriptor`, `WorkflowDescriptor`, `WorkflowRoleDescriptor` |
| **Registry** | `readWorkflowRegistry`, `writeWorkflowRegistry`, `registerWorkflowVersion`, `workflowRegistryPath`, YAML helpers |
| **CAS** | `createCasStore`, Merkle helpers (`putStepMerkleNode`, `getContentMerklePayload`, …), `hashWorkflowBundleBytes` |
| **Engine** | `createWorkflow`, `executeThread`, `parseThreadDataJsonl`, fork helpers, `garbageCollectCas` |
| **Extract / LLM tools** | `llmExtract`, `reactExtract`, `createExtract`, `getExtractProvider` |
| **Agent bridge** | `workflowAsAgent` — expose a registered workflow as an agent-backed role |
| **Utilities** | `createLogger`, ULID / Crockford Base32 codecs, `getDefaultWorkflowStorageRoot`, paths |

Full surface is re-exported from `src/index.ts`.
