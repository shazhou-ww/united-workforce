---
scenario: "A workflow-add output schema is registered under @uwf/output/workflow-add and bound to the writeOutput envelope pipeline"
feature: workflow
tags: [cli, format, text, schemas, output, workflow, add]
---

## Given
- `packages/protocol/src/output-schemas.ts` defines `OUTPUT_SCHEMAS` as the canonical map of CLI output schemas
- Pre-#334 keys: `thread-start`, `thread-status`, `thread-list`, `thread-exec`, `step-detail`, `step-list`, `workflow-detail`, `workflow-list`, `validate-result`
- `packages/cli/src/output-mappers.ts` exposes one mapper per schema (e.g. `toWorkflowListPayload`)
- `packages/cli/src/cli.ts` for `workflow add` previously called `writeRawOutput(result)` (NOT `writeOutput`)

## When
- The codebase is updated to add a `workflow-add` schema entry

## Then
- A new key `"workflow-add"` is present in `OUTPUT_SCHEMAS`
- The schema has `title: "@uwf/output/workflow-add"`, `type: "object"`, `additionalProperties: false`, and `required: ["name", "hash"]`
- Properties are `name: { type: "string" }` and `hash: { type: "string" }` (matching `WorkflowAddOutput` in `commands/workflow.ts`)
- `OutputSchemaName` (the keyof type) now includes `"workflow-add"` in its union
- `outputSchemaVarName("workflow-add")` returns `"@uwf/output/workflow-add"`

## Behavior: mapper exists in output-mappers.ts

### Given
- `packages/cli/src/output-mappers.ts` is the single source of payload mappers

### When
- The codebase is updated for #334

### Then
- A `WorkflowAddPayload` type is exported with shape `{ name: string; hash: string }`
- A `toWorkflowAddPayload(out: WorkflowAddOutput): WorkflowAddPayload` function is exported
- The mapper returns plain payload data (no CAS refs, no I/O), identical to the existing mapper pattern (see `toWorkflowListPayload`)

## Behavior: cli.ts uses writeOutput with the new schema

### Given
- `cli.ts` previously implemented `workflow add` as:

  ```ts
  const result = await cmdWorkflowAdd(storageRoot, file);
  writeRawOutput(result);
  ```

### When
- The codebase is updated for #334

### Then
- The `workflow add` action calls `writeOutput(toWorkflowAddPayload(result), "workflow-add", storageRoot)` instead of `writeRawOutput(result)`
- The call signature matches the existing pattern used by `workflow list`, `workflow show`, `validate`, `thread start`, `thread show`, `thread list`, `thread exec`, `step list`, and `step show`

## Behavior: schema is registered idempotently at CLI startup

### Given
- `packages/cli/src/schemas.ts` exports `registerUwfSchemas(store)` which calls `registerOutputSchemas(store)`
- `registerOutputSchemas` iterates `Object.keys(OUTPUT_SCHEMAS)` and binds `@uwf/output/<name>` for each

### When
- The new `"workflow-add"` key is added to `OUTPUT_SCHEMAS`

### Then
- `registerUwfSchemas(store)` automatically picks up the new schema (no per-command registration code needs to change)
- `store.var.get("@uwf/output/workflow-add")` resolves to the schema's CAS hash after CLI startup
- The bound schema's CAS payload validates objects of shape `{ name: "...", hash: "..." }`
