---
scenario: "Workflow authoring reference documents Liquid filter and loop capabilities"
feature: workflow
tags: [docs, liquidjs, authoring-reference, filters, loops]
---

## Given
- `packages/util/src/workflow-authoring-reference.ts` generates the workflow authoring guide
- LiquidJS supports filters (`{{ arr | join: ", " }}`) and loops (`{% for item in arr %}...{% endfor %}`) which Mustache did not
- The current reference text mentions Liquid syntax for field interpolation (`{{ field }}`) but does NOT document filters or loops

## When
- The authoring reference is updated to include Liquid-specific capabilities

## Then
- A new section (or subsection under "Edge Prompts" or similar) documents:
  - **Filters**: at least one example showing `{{ arrayField | join: ", " }}` in an edge prompt context
  - **Loops**: at least one example showing `{% for item in items %}{{ item }}{% endfor %}` in an edge prompt context
- Examples are shown within realistic edge prompt YAML (i.e. inside a `graph:` target's `prompt:` field)
- The documentation makes clear these are new capabilities available because of the LiquidJS engine
- `packages/cli/src/__tests__/prompt.test.ts` has a test verifying the reference mentions Liquid filters (e.g. checks for `| join` or `filter` keyword in the generated text)
- `pnpm run test` passes
