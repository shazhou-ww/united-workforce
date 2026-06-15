---
scenario: "Development scripts use node/tsx shebangs instead of bun"
feature: scripts
tags: [chore, bun-removal, scripts]
---

## Given

- `scripts/mock-agent.ts` exists with shebang `#!/usr/bin/env bun`

## When

- Inspect the shebang line of `scripts/mock-agent.ts`

## Then

- The shebang is `#!/usr/bin/env tsx` (not `#!/usr/bin/env bun`)
- The script executes correctly under tsx/node
