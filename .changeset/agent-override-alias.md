---
"@united-workforce/cli": patch
"@united-workforce/eval": patch
---

fix: resolve --agent override via config alias before raw command

`resolveAgentConfig()` now checks `config.agents[alias]` first before falling back to `parseAgentOverride()`. Eval CLI default `--agent` changed from `"hermes"` to `"uwf-hermes"`.
