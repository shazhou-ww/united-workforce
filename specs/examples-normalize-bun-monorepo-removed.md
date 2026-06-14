---
scenario: "Bun-specific workflow example is removed or repurposed"
feature: workflow
tags: [chore, bun-removal, examples]
---

## Given

- `examples/normalize-bun-monorepo.yaml` is a workflow entirely focused on setting up bun workspace structure

## When

- Check the `examples/` directory

## Then

- `examples/normalize-bun-monorepo.yaml` is deleted (the workflow is bun-specific and no longer relevant)
- No other example file references `bun` as a package manager to install/configure
