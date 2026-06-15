---
scenario: "examples/normalize-bun-monorepo.yaml uses Liquid {{ var }} syntax accepted by the 0.4.0 validator"
feature: workflow
tags: [liquidjs, examples, syntax, validate]
---

## Given
- `examples/normalize-bun-monorepo.yaml` previously used Mustache/Handlebars-style triple-brace `{{{var}}}` syntax in 22 graph edge prompts
- The affected variables are:
  - `{{{repoPath}}}` — used in success and continue prompts to thread the target repository path through the pipeline (`workspace`, `tsconfig`, `biome`, `package-metadata`, `release-pipeline`, `testing`, `gitea-ci`, `solve-issue`, `guardrails`, `commit` stages)
  - `{{{reason}}}` — used in failure-branch prompts to surface the prior stage's failure reason while continuing the pipeline
  - `{{{commitHash}}}` — used in the final `commit.committed` edge prompt
- The 0.4.0 LiquidJS-based validator rejects triple-brace Mustache syntax, treating the inner braced name as the variable `unknown` and reporting "template variable \"unknown\" not found"

## When
- The syntax migration is applied to `examples/normalize-bun-monorepo.yaml`

## Then
- All 22 occurrences of `{{{varName}}}` in graph edge prompts are replaced with `{{ varName }}` (Liquid syntax with single braces and surrounding spaces)
- Variable names (`repoPath`, `reason`, `commitHash`) are unchanged
- No `{{{` or `}}}` triple-brace sequences remain anywhere in the file
- All other YAML content (roles, frontmatter schemas, descriptions, procedures) is unchanged
- The graph edge structure (keys, target roles) is unchanged

---

## Given
- `examples/normalize-bun-monorepo.yaml` has been migrated to Liquid syntax

## When
- The user runs: `uwf workflow validate examples/normalize-bun-monorepo.yaml`

## Then
- Validation succeeds with no template-variable errors
- No "template variable \"unknown\" not found in role ... variant ..." errors are reported

---

## Given
- `examples/normalize-bun-monorepo.yaml` has been migrated to Liquid syntax
- The uwf CLI is installed at version 0.4.0 or later

## When
- The user runs: `uwf thread start examples/normalize-bun-monorepo.yaml -p "normalize repo at /tmp/example"`

## Then
- The thread is created successfully (no validation failure)
- The command does NOT print the error block beginning with `workflow validation failed:` followed by `template variable "unknown" not found` lines
