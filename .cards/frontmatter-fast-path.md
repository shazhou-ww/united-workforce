---
title: "Frontmatter Fast-Path — No LLM Extraction"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, decision]
category: "architecture"
links:
  - deterministic-engine-uncertain-agent
  - dissipative-structure-token-for-entropy
---

uwf 的 agent 输出提取管线做了一个关键简化：**完全不用 LLM 做结构化提取**。

流程：agent 输出 → 解析 YAML frontmatter → 校验 JSON Schema → 成功则继续，失败则让**同一个 agent** 在原 session 内追加轮次自修（最多 2 次）。

为什么不用单独的 LLM 提取：
1. **原始 agent 有完整上下文**（tool call 历史、任务理解），另起 LLM 只能猜
2. **零额外 token 成本**（fast-path 是纯字符串解析 + schema 校验）
3. **重试走 continue() 而非新 session**，保持对话连贯性

这是 PR #142 (ThreadReactor) 确立的模式。之前存在的 `extract()` LLM fallback 已成死代码。
