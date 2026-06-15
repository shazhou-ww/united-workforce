---
scenario: "Workflow YAML files use Liquid {{ var }} syntax instead of Mustache {{{var}}}"
feature: workflow
tags: [liquidjs, migration, syntax]
---

## Given
- The uwf repo `.workflows/` directory contains: `solve-issue.yaml`, `release.yaml`, `triage-issues.yaml`, `review-pr.yaml`
- These files previously used Mustache triple-brace syntax `{{{varName}}}` for unescaped variable interpolation

## When
- The syntax migration is applied to all `.workflows/*.yaml` files in the uwf repo

## Then
- All `{{{varName}}}` occurrences are replaced with `{{ varName }}` (Liquid syntax with spaces inside braces)
- No double-brace Mustache `{{varName}}` (which would HTML-escape) remains — all are converted to Liquid `{{ varName }}`
- The variable names inside the templates remain unchanged
- The YAML structure (keys, roles, graph edges) is unchanged
- `uwf workflow validate` passes for each migrated file (templates render without errors against their schemas)

---

## Given
- `packages/cli/package.json` has `"mustache": "^4.2.0"` as a dependency and `"@types/mustache": "^4.2.6"` as a devDependency

## When
- The dependency migration is applied

## Then
- `"mustache"` is removed from dependencies
- `"@types/mustache"` is removed from devDependencies
- `"liquidjs": "^10.27.0"` is added to dependencies
- No other dependencies are affected
- `pnpm install` succeeds without errors
