---
scenario: "Workflow authoring reference uses Liquid terminology throughout with no Mustache remnants"
feature: workflow
tags: [docs, liquidjs, migration, authoring-reference]
---

## Given
- `packages/util/src/workflow-authoring-reference.ts` exports `generateWorkflowAuthoringReference()`
- Phase 1 (PR #270) already replaced the template engine from Mustache to LiquidJS
- The reference text currently uses Liquid `{{ field }}` syntax in YAML examples (already migrated in Phase 1)
- The reference text has no remaining occurrences of the word "Mustache" (verified by grep)

## When
- The generated reference text is inspected for terminology consistency

## Then
- The string "Mustache" does NOT appear anywhere in the output of `generateWorkflowAuthoringReference()`
- All template-related descriptions use "Liquid" terminology (e.g. "Liquid templates", "Liquid template references", "Liquid template variable mismatch")
- The text documents Liquid-specific capabilities not available in Mustache:
  - Filter syntax example: `{{ arr | join: ", " }}`
  - Loop syntax example: `{% for item in arr %}...{% endfor %}`
- Existing Liquid `{{ field }}` syntax examples in edge prompts remain unchanged
- `pnpm run typecheck` passes for `packages/util`
