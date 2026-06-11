---
scenario: "examples/debate.yaml uses Liquid {{ var }} syntax accepted by the 0.4.0 validator"
feature: workflow
tags: [liquidjs, examples, syntax, validate]
---

## Given
- `examples/debate.yaml` previously used Mustache/Handlebars-style triple-brace `{{{var}}}` syntax in 6 graph edge prompts
- The affected edges and variables are:
  - `proponent.speak` → `{{{argument}}}`
  - `proponent.conceded` → `{{{reason}}}`
  - `proponent.final` → `{{{closing}}}`
  - `opponent.speak` → `{{{argument}}}`
  - `opponent.conceded` → `{{{reason}}}`
  - `opponent.final` → `{{{closing}}}`
- The 0.4.0 LiquidJS-based validator rejects triple-brace Mustache syntax, treating the inner braced name as the variable `unknown` and reporting "template variable \"unknown\" not found"

## When
- The syntax migration is applied to `examples/debate.yaml`

## Then
- All 6 occurrences of `{{{varName}}}` in graph edge prompts are replaced with `{{ varName }}` (Liquid syntax with single braces and surrounding spaces)
- Variable names (`argument`, `reason`, `closing`) are unchanged
- No `{{{` or `}}}` triple-brace sequences remain anywhere in the file
- All other YAML content (roles, frontmatter schemas, descriptions, procedures) is unchanged
- The graph edge structure (keys, target roles) is unchanged

---

## Given
- `examples/debate.yaml` has been migrated to Liquid syntax

## When
- The user runs: `uwf workflow validate examples/debate.yaml`

## Then
- Validation succeeds with no template-variable errors
- No "template variable \"unknown\" not found in role ... variant ..." errors are reported

---

## Given
- `examples/debate.yaml` has been migrated to Liquid syntax
- The uwf CLI is installed at version 0.4.0 or later

## When
- The user runs: `uwf thread start examples/debate.yaml -p "test topic"`

## Then
- The thread is created successfully (no validation failure)
- The command does NOT print the error block beginning with `workflow validation failed:` followed by six `template variable "unknown" not found` lines
