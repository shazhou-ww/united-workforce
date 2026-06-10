---
scenario: "Test descriptions and comments say Liquid instead of Mustache"
feature: workflow
tags: [docs, liquidjs, migration, tests]
---

## Given
- `packages/cli/src/__tests__/workflow-validate.test.ts` has:
  - A helper function comment: "Build a valid writer→reviewer workflow with mustache var."
  - A test name: "A.2 valid multi-role workflow with mustache vars exits 0 silent"
  - A comment: "3) bad mustache variable"
- `packages/cli/src/__tests__/e2e-mock-agent.test.ts` has:
  - Test name: "6. mustache edge prompt renders planner variables into the worker step"
  - Mock config filename: `"e2e-mustache.mock.yaml"` and workflow filename: `"e2e-mustache.workflow.yaml"`
  - Comment: "The worker step's edgePrompt is the mustache-rendered template."

## When
- All test descriptions, comments, and identifiers are updated from "mustache" to "Liquid"

## Then
- `workflow-validate.test.ts`:
  - Helper comment reads: "Build a valid writer→reviewer workflow with Liquid var."
  - Test name reads: "A.2 valid multi-role workflow with Liquid vars exits 0 silent"
  - Comment reads: "3) bad Liquid variable"
- `e2e-mock-agent.test.ts`:
  - Test name reads: "6. Liquid edge prompt renders planner variables into the worker step"
  - Comment reads: "The worker step's edgePrompt is the Liquid-rendered template."
  - Note: mock fixture filenames (`e2e-mustache.mock.yaml`, `e2e-mustache.workflow.yaml`) MAY be renamed to `e2e-liquid.*` if the corresponding fixture files are also renamed, OR left as-is if renaming would break other references — implementer's discretion
- The word "mustache" (case-insensitive) does NOT appear in any `.ts` file under `packages/` (excluding `node_modules`)
- `pnpm run test` passes for all affected packages
