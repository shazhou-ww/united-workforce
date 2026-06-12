---
"@united-workforce/protocol": patch
"@united-workforce/cli": patch
---

Fix `uwf workflow add` defaulting to raw JSON output (issue #334).

`workflow add` was the only data-producing CLI command that did not migrate
to the per-command renderer registry introduced in #329. It still called
`writeRawOutput(result)`, so the default `--format text` printed
`{"name":"...","hash":"..."}` raw JSON instead of human-readable text.

Changes:

- New `WORKFLOW_ADD_OUTPUT_SCHEMA` registered under `@uwf/output/workflow-add`
  with `name` and `hash` string fields (`additionalProperties: false`).
- New `OUTPUT_TEMPLATES["workflow-add"]` Liquid template renders the result
  as labelled key-value lines:

  ```
  Registered  review-pr
  Hash        2TBP6T37TZAJZ
  ```

- New `WorkflowAddPayload` type and `toWorkflowAddPayload` mapper in
  `@united-workforce/cli/src/output-mappers.ts`.
- The `workflow add` action now calls
  `writeOutput(toWorkflowAddPayload(result), "workflow-add", storageRoot)`
  so all five formats (`text`, `json`, `yaml`, `raw-json`, `raw-yaml`) are
  honored consistently with every other data-producing command.
