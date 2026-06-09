---
title: "Status-Based Moderator — Pure Lookup, Zero LLM"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, decision]
category: "architecture"
links:
  - deterministic-engine-uncertain-agent
  - agent-cli-protocol
  - suspend-as-coroutine-yield
  - frontmatter-fast-path
---

uwf 的 moderator（路由器）完全不用 LLM，是纯查表操作：

```
graph[lastRole][lastOutput.$status] → { role, prompt, location }
```

1. 从 agent 输出的 frontmatter 读 `$status` 字段
2. 在 workflow graph 中查 `graph[lastRole][status]` 拿到 Target
3. 用 Mustache 渲染 edge prompt（变量来自 agent 输出的 frontmatter 字段）
4. 路由到下一个 role，或 `$END`（完成）

注意：`$SUSPEND` 不经过 moderator。引擎在 moderator 之前拦截 `$status: "$SUSPEND"` 输出，直接挂起线程。参见 [[suspend-as-coroutine-yield]]。

这意味着 workflow 的**流转逻辑完全确定性**——给定 agent 输出，下一步去哪里是固定的。不确定性只存在于 agent session 内部。

Mustache 渲染禁用了 HTML 转义（`mustache.escape = text => text`），因为 prompt 是纯文本。
