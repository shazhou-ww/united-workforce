---
scenario: "Defensive test for engines.bun absence is preserved"
feature: agent-hermes
tags: [chore, bun-removal, test]
---

## Given

- `packages/agent-hermes/__tests__/issue-551.test.ts` verifies that `engines.bun` does not exist in package.json

## When

- Inspect `packages/agent-hermes/__tests__/issue-551.test.ts`

## Then

- The test file is preserved (NOT deleted)
- It continues to assert that no `engines.bun` field exists, serving as a regression guard
