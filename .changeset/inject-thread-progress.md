---
"@united-workforce/agent-hermes": patch
"@united-workforce/agent-claude-code": patch
"@united-workforce/util-agent": patch
---

feat: inject thread progress into agent prompt (#127)

Agents now receive a "Thread Progress" section in their prompt showing the
current step number and how many times the current role has spoken before.
This eliminates the need for agents to make tool calls (terminal, delegate_task)
just to count their own turn history.
