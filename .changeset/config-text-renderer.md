---
"@united-workforce/cli": patch
---

Fix config list/get/set commands to use text renderers when `--format text` is specified. Previously these commands always output raw JSON regardless of format. Now `config list` renders flattened dot-notation key-value pairs, `config get` renders the bare value (or flattened object), and `config set` renders a `key = value` confirmation line.
