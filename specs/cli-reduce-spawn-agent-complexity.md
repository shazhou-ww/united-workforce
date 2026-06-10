---
scenario: "spawnAgent function must have cognitive complexity ≤ 15"
feature: cli
tags: [lint, complexity, refactor]
---

## Given

- `packages/cli/src/commands/thread.ts` contains `spawnAgent()` function at line 1053
- The function has cognitive complexity of 21 (exceeds the limit of 15)
- Biome lint rule `lint/complexity/noExcessiveCognitiveComplexity` is enabled
- The function handles agent command execution, error handling, and output parsing

## When

- Running `pnpm run check` in the repository root

## Then

- The `spawnAgent()` function must pass `lint/complexity/noExcessiveCognitiveComplexity` check
- Cognitive complexity must be reduced to 15 or below through function decomposition
- Original behavior must be preserved:
  - Execute agent command with correct argv
  - Handle ENOENT error (command not found)
  - Handle generic execution errors with stderr
  - Parse JSON output from stdout last line
  - Validate JSON structure (stepHash field)
  - Normalize isError and errorMessage fields
  - Call failStep() for any validation failures
- Extracted helper functions must follow project conventions:
  - Use `function` keyword (not arrow functions)
  - Maintain clear separation of concerns
  - Preserve error messages exactly as they are
