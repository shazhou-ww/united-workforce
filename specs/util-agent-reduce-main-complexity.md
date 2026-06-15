---
scenario: "createAgent main function must have cognitive complexity ≤ 15"
feature: util-agent
tags: [lint, complexity, refactor]
---

## Given

- `packages/util-agent/src/run.ts` contains `createAgent()` that returns an async `main()` function at line 275
- The `main()` function has cognitive complexity of 16 (exceeds the limit of 15)
- Biome lint rule `lint/complexity/noExcessiveCognitiveComplexity` is enabled
- The function orchestrates: argv parsing, context building, schema resolution, agent execution, and frontmatter extraction with retries

## When

- Running `pnpm run check` in the repository root

## Then

- The `main()` function must pass `lint/complexity/noExcessiveCognitiveComplexity` check
- Cognitive complexity must be reduced to 15 or below through function decomposition
- Original behavior must be preserved:
  - Parse argv to extract threadId, role, prompt
  - Resolve agent directories (storageRoot, casDir)
  - Load .env file
  - Build context with metadata
  - Validate role exists in workflow
  - Resolve frontmatter schema
  - Build output format instruction
  - Run agent and trim output
  - Preserve primary detail hash from first run
  - Accumulate usage across retries
  - Retry frontmatter extraction up to MAX_FRONTMATTER_RETRIES times
  - On extraction failure after retries: persist ErrorOutputPayload with phase="frontmatter_extraction"
  - On success: continue to step persistence
- Extracted helper functions must follow project conventions:
  - Use `function` keyword (not arrow functions)
  - Use named exports
  - Maintain clear separation of concerns
  - Preserve all error messages and logging behavior
