---
scenario: "examples/solve-issue.yaml uses Liquid {{ var }} syntax accepted by the 0.4.0 validator"
feature: workflow
tags: [liquidjs, examples, syntax, validate]
---

## Given
- `examples/solve-issue.yaml` previously used Mustache/Handlebars-style triple-brace `{{{var}}}` syntax in 11 graph edge prompts (lines 238–252)
- The affected edges and variables are:
  - `planner.ready` → `{{{plan}}}`, `{{{repoPath}}}`
  - `planner.continue` → `{{{branch}}}`, `{{{worktree}}}`, `{{{plan}}}`, `{{{repoPath}}}`
  - `developer.done` → `{{{branch}}}`, `{{{worktree}}}`
  - `developer.failed` → `{{{reason}}}`
  - `reviewer.rejected` → `{{{comments}}}`, `{{{worktree}}}`
  - `reviewer.approved` → `{{{branch}}}`, `{{{worktree}}}`
  - `tester.fix_code` → `{{{report}}}`
  - `tester.fix_spec` → `{{{report}}}`
  - `tester.passed` → `{{{branch}}}`, `{{{worktree}}}`
  - `committer.hook_failed` → `{{{error}}}`
  - `committer.committed` → `{{{prUrl}}}`
- The 0.4.0 LiquidJS-based validator rejects triple-brace Mustache syntax, treating the inner braced name as the variable `unknown` and reporting "template variable \"unknown\" not found"

## When
- The syntax migration is applied to `examples/solve-issue.yaml`

## Then
- All 11 occurrences of `{{{varName}}}` in graph edge prompts are replaced with `{{ varName }}` (Liquid syntax with single braces and surrounding spaces)
- Variable names (`plan`, `repoPath`, `branch`, `worktree`, `reason`, `comments`, `report`, `error`, `prUrl`) are unchanged
- No `{{{` or `}}}` triple-brace sequences remain anywhere in the file
- All other YAML content (roles, frontmatter schemas, descriptions, procedures) is unchanged
- The graph edge structure (keys, target roles) is unchanged

---

## Given
- `examples/solve-issue.yaml` has been migrated to Liquid syntax

## When
- The user runs: `uwf workflow validate examples/solve-issue.yaml`

## Then
- Validation succeeds with no template-variable errors
- No "template variable \"unknown\" not found in role ... variant ..." errors are reported

---

## Given
- `examples/solve-issue.yaml` has been migrated to Liquid syntax
- The uwf CLI is installed at version 0.4.0 or later

## When
- The user runs: `uwf thread start examples/solve-issue.yaml -p "fix issue #1 in repo /tmp/example"`

## Then
- The thread is created successfully (no validation failure)
- The command does NOT print the error block beginning with `workflow validation failed:` followed by `template variable "unknown" not found` lines
