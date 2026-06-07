---
title: "Agent CLI Protocol — Adapter Output via stdout"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, protocol]
category: "architecture"
links:
  - deterministic-engine-uncertain-agent
  - frontmatter-fast-path
---

uwf 的 agent 通过 CLI 协议与 engine 通信。

**调用方式**：`<agent-cmd> --thread <id> --role <role> --prompt <text>`

**输出协议**：agent 将 `AdapterOutput` JSON 写入 stdout 的最后一行。包含：
- `stepHash` — 新 StepNode 的 CAS hash
- `detailHash` — 完整 agent 交互记录（tool call 历史）
- `role` — 角色名
- `frontmatter` — 提取的结构化输出
- `body` — markdown 正文
- `usage` — token 用量统计（turns, input/output tokens, duration）

**关键设计**：agent 进程完全独立——自己读 CAS 拿上下文、自己写 StepNode、自己做 frontmatter 校验和重试。engine 只负责调度和路由。这保证了 agent 实现可以随时替换（builtin / hermes / claude-code），协议层面完全对等。
