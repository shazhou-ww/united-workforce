---
scenario: "A Liquid text template for workflow-add is registered and renders Registered/Hash key-value lines under --format text"
feature: workflow
tags: [cli, format, text, templates, workflow, add]
---

## Given
- `packages/protocol/src/output-templates.ts` exports `OUTPUT_TEMPLATES: Record<OutputSchemaName, string>`
- For each existing entry (e.g. `thread-start`, `workflow-detail`), the template is a Liquid string keyed by the same short name as the matching schema
- `packages/cli/src/schemas.ts` registers each template in CAS as an `@ocas/string` node and binds `@ocas/template/text/<schemaHash>` to the content hash
- `formatOutput` / `writeEnvelope` look up the template via the schema's CAS hash and render it with `payload` plus top-level field merging

## When
- The codebase is updated to add a `workflow-add` template

## Then
- `OUTPUT_TEMPLATES["workflow-add"]` is a Liquid template string
- The template renders two key-value lines using the merged top-level fields `name` and `hash`:

  ```
  Registered  {{ name }}
  Hash        {{ hash }}
  ```

- The exact label/spacing is consistent with the labelled-rows style of `THREAD_START_TEMPLATE`, `THREAD_STATUS_TEMPLATE`, `STEP_DETAIL_TEMPLATE`, and `WORKFLOW_DETAIL_TEMPLATE` (label, whitespace, value)
- The template does NOT wrap output in a JSON envelope
- The template does NOT add a trailing newline (the renderer strips trailing `\n+` and the envelope writer appends a single `\n`)

## Behavior: template is registered in CAS at startup

### Given
- `registerOutputSchemas(store)` iterates every name in `OUTPUT_SCHEMAS`, stores `OUTPUT_TEMPLATES[name]` as `@ocas/string`, and binds `@ocas/template/text/<schemaHash>`

### When
- The new `"workflow-add"` entry is present in both `OUTPUT_SCHEMAS` and `OUTPUT_TEMPLATES`

### Then
- After CLI startup, `store.var.get("@ocas/template/text/<workflowAddSchemaHash>")` resolves to a CAS node containing the template string
- `writeEnvelope(payload, "workflow-add", { format: "text", store, schemas })` renders via this template

## Behavior: rendered output for a real workflow

### Given
- `payload = { name: "review-pr", hash: "2TBP6T37TZAJZ" }`
- `--format text`

### When
- The template is rendered via `writeEnvelope(payload, "workflow-add", ...)`

### Then
- Stdout (before the envelope writer's trailing `\n`) is exactly:

  ```
  Registered  review-pr
  Hash        2TBP6T37TZAJZ
  ```

- After the envelope writer appends `\n`, stdout has a single trailing newline (no double-newline)
- Output contains no `{` or `:` characters (no JSON-shape leakage)

## Behavior: template tolerates partial data

### Given
- `payload = { name: "review-pr", hash: "" }` (e.g. degenerate case)

### When
- The template is rendered

### Then
- The template does NOT throw
- Empty string fields render as empty values (e.g. `Hash        ` with trailing whitespace tolerated)
- The renderer does NOT fall back to YAML
- Exit code is 0

## Behavior: missing template warning path remains intact

### Given
- A hypothetical `OUTPUT_TEMPLATES` entry is missing for some schema (NOT `workflow-add` post-fix)

### When
- `writeEnvelope(payload, schemaName, { format: "text", ... })` is called

### Then
- `renderEnvelopeText` writes a `warning: missing text template for @uwf/output/<name>` line to stderr
- Stdout falls back to a YAML envelope
- This is the existing behavior from #329; #334 simply ensures `workflow-add` is no longer in the missing-template path
