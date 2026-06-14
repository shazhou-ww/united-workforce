---
scenario: "Source code comments reference node instead of bun"
feature: agent-hermes
tags: [chore, bun-removal, source]
---

## Given

- `packages/agent-hermes/src/hermes.ts` around line 263 has a comment: "so the hermes subprocess exits and bun can terminate"

## When

- Inspect the comment in `packages/agent-hermes/src/hermes.ts`

## Then

- The comment is updated to reference "node" or "the process" instead of "bun"
- e.g. "so the hermes subprocess exits and the process can terminate"
