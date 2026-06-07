---
"@united-workforce/cli": patch
"@united-workforce/util": patch
---

fix(cli): align `uwf workflow list` with `uwf thread start` parent traversal; document `.workflow/` auto-discovery (#162)

`discoverProjectWorkflows()` now walks from `cwd` up through parent directories
looking for the nearest `.workflow/` (or legacy `.workflows/`), mirroring
`findWorkflowInParents()` used by `uwf thread start`. Previously, `uwf workflow
list` only inspected the exact `cwd` and returned `[]` when run from any
subdirectory, even though `uwf thread start <name>` succeeded from the same
location. The two commands now agree on what is discoverable.

The `@united-workforce/util` reference strings (`generateUsageReference`,
`generateCliReference`, `generateWorkflowAuthoringReference`) are updated to
document project-local `.workflow/` auto-discovery and recommend it as the
primary placement strategy — `uwf workflow add` registration is only needed for
global, cwd-independent workflows.
