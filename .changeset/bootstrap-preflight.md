---
"@united-workforce/cli": patch
---

fix: bootstrap adds Step 0 environment pre-flight check

- Pre-flight checks for node, pnpm/npm, global bin PATH, hermes CLI with FIX instructions (#112)
- Install commands changed from npm to pnpm (with npm fallback)
