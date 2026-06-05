---
"@united-workforce/cli": patch
"@united-workforce/util": patch
---

fix: unify $status to const-only, drop enum support (#123)

Breaking: `$status` in frontmatter now requires `const` everywhere.
`enum` is no longer accepted and will be rejected by the validator.

- Validator: `hasStatusConst()` / `getConstStatuses()` replace enum-based checks
- Error message: "must define $status as const (or oneOf with const)"
- workflow-authoring docs: all examples use `const`, enum explicitly noted as unsupported
- bootstrap hello.yaml: `$status: { const: done }`
- All test fixtures migrated from enum to const/oneOf
