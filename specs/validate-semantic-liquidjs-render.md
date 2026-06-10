---
scenario: "Workflow validator detects missing template variables via LiquidJS strict render"
feature: workflow
tags: [validate, liquidjs, template]
---

## Given
- `packages/cli/src/validate-semantic.ts` no longer contains `extractMustacheVars()`, `checkMultiExitMustache()`, or `checkFlatMustache()` functions
- A new `validateEdgeTemplates()` function exists that:
  - Iterates over each role's graph edges
  - Generates mock data from the role's frontmatter JSON Schema (property names → mock values)
  - Creates a LiquidJS engine with `strictVariables: true`
  - Attempts to render each edge prompt template against the mock data

## When
- `validateWorkflow(payload)` is called on a workflow where an edge prompt references a variable that does not exist in the source role's frontmatter schema

## Then
- LiquidJS throws an error due to `strictVariables: true` encountering an undefined variable
- The error is caught and added to the errors array with a descriptive message indicating which variable is missing and which role/edge it belongs to
- The validation result is the same shape as before: `string[]` of error messages

---

## Given
- A workflow where all edge prompt variables are defined in the source role's frontmatter schema

## When
- `validateWorkflow(payload)` is called

## Then
- `validateEdgeTemplates()` renders all templates successfully (no throws from `strictVariables`)
- No template-related errors are added
- The function returns `[]` (assuming no other validation errors exist)

---

## Given
- A multi-exit role (oneOf schema) with different properties per variant

## When
- Edge `role→statusA` uses `{{ propFromVariantA }}` and edge `role→statusB` uses `{{ propFromVariantB }}`

## Then
- Each edge is validated against ONLY its matching variant's properties (matched by `$status` const value)
- `{{ propFromVariantA }}` in the `statusA` edge passes (property exists in variant A)
- `{{ propFromVariantA }}` in the `statusB` edge fails (property not in variant B)
