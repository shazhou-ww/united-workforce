---
"@united-workforce/cli": patch
"@united-workforce/agent-hermes": patch
"@united-workforce/agent-claude-code": patch
"@united-workforce/agent-builtin": patch
"@united-workforce/agent-mock": patch
---

fix: suppress ExperimentalWarning, PEP 668 pip guidance, setup help (#116)

- All CLI bins use shebang `#!/usr/bin/env -S node --disable-warning=ExperimentalWarning`
- Remove NODE_OPTIONS injection from spawn (shebang handles it)
- Bootstrap pip install guidance covers venv/pipx/source options for PEP 668 systems
- `uwf setup --help` mentions interactive wizard mode
