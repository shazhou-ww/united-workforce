---
"@united-workforce/cli": patch
---

Remove stale LLM provider/model references from bootstrap prompt and BOOTSTRAP.md. Engine config is now LLM-free — `uwf setup` only takes `--agent`. Config shows only `agents`, `defaultAgent`, `agentOverrides`.
