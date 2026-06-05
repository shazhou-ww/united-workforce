# @united-workforce/cli

## 0.1.1

### Patch Changes

- 850a3b2: fix: resolve --agent override via config alias before raw command

  `resolveAgentConfig()` now checks `config.agents[alias]` first before falling back to `parseAgentOverride()`. Eval CLI default `--agent` changed from `"hermes"` to `"uwf-hermes"`.
