---
title: "Agent CLI Protocol — Adapter Output via stdout"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, protocol]
category: "architecture"
links:
  - deterministic-engine-uncertain-agent
  - frontmatter-fast-path
  - suspend-as-coroutine-yield
  - three-interaction-modes
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

**`$SUSPEND` 输出**：任何 adapter 可以在输出中发射 `{ $status: "$SUSPEND", reason: string }`。engine 在 moderator 之前拦截，step 正常写入 CAS，线程挂起。adapter 在碰到资源限制（token budget 耗尽、context window 溢出）时应该主动 yield `$SUSPEND` 而非产出垃圾输出。`buildSuspendOutput(reason)` 是 `@united-workforce/util-agent` 提供的标准 helper。

**Fork / Ask 模式**：adapter 可实现 `fork(sessionId)` 回调，支持 `step ask` 从历史 session 分叉出只读追问。ask-session 通过 `getAskSessionId` / `setAskSessionId` 缓存，避免重复 fork。

**LLM 配置自治**：engine 不持有任何 LLM 配置。每个 adapter 自行管理——例如 builtin adapter 从 `<storageRoot>/agents/builtin.yaml` 加载 `{ provider: { baseUrl, apiKey }, model }`。
