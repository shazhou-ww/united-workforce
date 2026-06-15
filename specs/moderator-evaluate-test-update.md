---
scenario: "Moderator evaluate tests use Liquid {{ var }} syntax and pass with LiquidJS engine"
feature: thread
tags: [moderator, liquidjs, test]
---

## Given
- `packages/cli/src/moderator/__tests__/evaluate.test.ts` contains test cases using `{{{varName}}}` Mustache syntax in graph prompt templates

## When
- The test file is updated to use Liquid `{{ varName }}` syntax

## Then
- All template strings in test fixtures use `{{ varName }}` (double-brace with spaces) instead of `{{{varName}}}` (triple-brace)
- Test "returns error when rendered prompt is empty string" uses `{{ userPrompt }}` — still resolves to empty when variable is missing
- Test "succeeds when all template variables resolve" uses `{{ userPrompt }}` — resolves to provided value
- Test "resolves mustache template location" is renamed/updated to "resolves liquid template location" using `{{ repoPath }}`
- All tests pass with the LiquidJS-based evaluate implementation
- The test behavior (empty-prompt detection, variable resolution, location rendering) remains logically identical

---

## Given
- `packages/cli/src/__tests__/validate-semantic.test.ts` Suite 4 "Mustache Template Variable Existence" uses regex-based validation assertions

## When
- Suite 4 is rewritten to test the new LiquidJS strict-render validation approach

## Then
- Tests verify that missing variables are caught by the strict-render approach (same error semantics: variable name + role name in message)
- Tests verify that valid variables pass without errors
- Tests verify that `$status` is always valid (not flagged as missing)
- Template syntax in test fixtures uses `{{ var }}` instead of `{{{var}}}`
- All remaining suites (1–3, 5, 7) update their fixture template syntax from `{{{var}}}` to `{{ var }}` where templates appear in test data
