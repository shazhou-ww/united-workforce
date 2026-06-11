---
scenario: "examples/e2e-walkthrough.yaml uses Liquid {{ var }} syntax accepted by the 0.4.0 validator"
feature: workflow
tags: [liquidjs, examples, syntax, validate]
---

## Given
- `examples/e2e-walkthrough.yaml` previously used Mustache/Handlebars-style triple-brace `{{{var}}}` syntax in 12 graph edge prompts (lines 268–284)
- The affected edges and variables are:
  - `bootstrap.pass` → `{{{containerName}}}`
  - `bootstrap.fail` → `{{{error}}}`
  - `config-and-registry.pass` → `{{{workflowName}}}`, `{{{containerName}}}`
  - `config-and-registry.fail` → `{{{error}}}`, `{{{containerName}}}`
  - `thread-ops.pass` → `{{{threadId}}}`, `{{{workflowName}}}`, `{{{containerName}}}`
  - `thread-ops.fail` → `{{{error}}}`, `{{{containerName}}}`
  - `inspect.pass` → `{{{threadId}}}`, `{{{lastStepHash}}}`, `{{{workflowName}}}`, `{{{containerName}}}`
  - `inspect.fail` → `{{{error}}}`, `{{{containerName}}}`
  - `cancel-and-fork.pass` → `{{{summary}}}`, `{{{containerName}}}`
  - `cancel-and-fork.fail` → `{{{error}}}`, `{{{containerName}}}`
  - `cleanup.pass` → `{{{summary}}}`
  - `cleanup.fail` → `{{{error}}}`
- The 0.4.0 LiquidJS-based validator rejects triple-brace Mustache syntax, treating the inner braced name as the variable `unknown` and reporting "template variable \"unknown\" not found"

## When
- The syntax migration is applied to `examples/e2e-walkthrough.yaml`

## Then
- All 12 occurrences of `{{{varName}}}` in graph edge prompts are replaced with `{{ varName }}` (Liquid syntax with single braces and surrounding spaces)
- Variable names (`containerName`, `error`, `workflowName`, `threadId`, `lastStepHash`, `summary`) are unchanged
- No `{{{` or `}}}` triple-brace sequences remain anywhere in the file
- All other YAML content (roles, frontmatter schemas, descriptions, procedures) is unchanged
- The graph edge structure (keys, target roles) is unchanged

---

## Given
- `examples/e2e-walkthrough.yaml` has been migrated to Liquid syntax

## When
- The user runs: `uwf workflow validate examples/e2e-walkthrough.yaml`

## Then
- Validation succeeds with no template-variable errors
- No "template variable \"unknown\" not found in role ... variant ..." errors are reported

---

## Given
- `examples/e2e-walkthrough.yaml` has been migrated to Liquid syntax
- The uwf CLI is installed at version 0.4.0 or later

## When
- The user runs: `uwf thread start examples/e2e-walkthrough.yaml -p "test bootstrap"`

## Then
- The thread is created successfully (no validation failure)
- The command does NOT print the error block beginning with `workflow validation failed:` followed by `template variable "unknown" not found` lines
