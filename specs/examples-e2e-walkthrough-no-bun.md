---
scenario: "E2E walkthrough YAML example does not reference bun install"
feature: workflow
tags: [chore, bun-removal, examples]
---

## Given

- `examples/e2e-walkthrough.yaml` mentions `bun install` overwriting host files

## When

- Inspect the contents of `examples/e2e-walkthrough.yaml`

## Then

- References to `bun install` are updated to `pnpm install` or the comment is reworded to be package-manager neutral
- The workflow definition remains valid YAML and functionally correct
