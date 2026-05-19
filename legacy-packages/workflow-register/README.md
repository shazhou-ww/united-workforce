# @uncaged/workflow-register

Bundle validation, dynamic export extraction, registry YAML, and model/provider resolution.

## What This Package Does

It validates workflow `.esm.js` bundles, extracts `descriptor` / `run` exports at runtime, reads and writes `workflow.yaml`, and resolves which LLM endpoint/model to use from registry config (`resolveModel`, `splitProviderModelRef`).

## Key Exports

From `src/index.ts`:

- **Bundle:** `buildDescriptor`, `importWorkflowBundleModule`, `validateWorkflowBundle`, `ensureUncagedWorkflowSymlink`, `extractBundleExports`, `stringifyWorkflowDescriptor`, `validateWorkflowDescriptor`
- **Bundle types:** `ExtractBundleExportsOptions`, `ExtractedBundleExports`, `WorkflowBundleValidationInput`, `WorkflowDescriptor`, `WorkflowRoleDescriptor`, `WorkflowRoleSchema`
- **Registry:** `getRegisteredWorkflow`, `listRegisteredWorkflowNames`, `parseWorkflowRegistryYaml`, `readWorkflowRegistry`, `registerWorkflowVersion`, `rollbackWorkflowToHistoryHash`, `stringifyWorkflowRegistryYaml`, `unregisterWorkflow`, `workflowRegistryPath`, `writeWorkflowRegistry`
- **Registry types:** `WorkflowConfig`, `WorkflowHistoryEntry`, `WorkflowRegistryEntry`, `WorkflowRegistryFile`
- **Config:** `resolveModel`, `splitProviderModelRef`, types `ProviderConfig`, `ResolvedModel`

## Dependencies

- **Workspace:** `@uncaged/workflow-protocol`, `@uncaged/workflow-util`
- **Peer:** `acorn`, `yaml`, `zod` ^4 — parsing/validation at runtime for consumers

## Usage

```typescript
import { readFile } from "node:fs/promises";
import { readWorkflowRegistry, validateWorkflowBundle } from "@uncaged/workflow-register";
import { getDefaultWorkflowStorageRoot } from "@uncaged/workflow-util";

const reg = await readWorkflowRegistry(getDefaultWorkflowStorageRoot());
if (!reg.ok) throw new Error(reg.error.message);

const path = "./my.esm.js";
const source = await readFile(path, "utf8");
const v = validateWorkflowBundle({ filePath: path, source });
if (!v.ok) throw new Error(v.error);
```
