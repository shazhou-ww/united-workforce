---
"@united-workforce/util": patch
---

docs: fix workflow-authoring guide oneOf documentation (#244)

The "Frontmatter Schema" section incorrectly stated that `type: object` is **required**
at the top level of frontmatter for both flat and `oneOf` schemas. This contradicts
the runtime: `collectObjectSchemas` in `build-output-format-instruction.ts` never
inspects `type`; it only follows `properties` / `oneOf` / `anyOf`. A sibling
`type: object` next to `oneOf` creates an unnecessary implicit conjunction.

Changes:

- The "Multi-exit (oneOf)" example no longer shows a sibling `type: object`.
- The workflow-structure example's planner role schema is corrected the same way.
- The "Important rules" bullet now distinguishes flat vs. `oneOf` schemas:
  flat schemas keep `type: object`; `oneOf` schemas must NOT have a sibling
  `type: object` and let each variant declare its own `properties`/`required`.

Adds `packages/util/__tests__/workflow-authoring-reference.test.ts` with 11
assertions guarding the corrected guidance and the unchanged flat examples.
