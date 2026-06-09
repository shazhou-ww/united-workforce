---
title: "Frontmatter Fast-Path — No LLM Extraction"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, decision]
category: "architecture"
links:
  - deterministic-engine-uncertain-agent
  - dissipative-structure-token-for-entropy
  - suspend-as-coroutine-yield
---

uwf 的 agent 输出提取管线做了一个关键简化：**完全不用 LLM 做结构化提取**。

流程：agent 输出 → 解析 YAML frontmatter → 校验 JSON Schema → 成功则继续，失败则让**同一个 agent** 在原 session 内追加轮次自修（最多 2 次）。

为什么不用单独的 LLM 提取：
1. **原始 agent 有完整上下文**（tool call 历史、任务理解），另起 LLM 只能猜
2. **零额外 token 成本**（fast-path 是纯字符串解析 + schema 校验）
3. **重试走 continue() 而非新 session**，保持对话连贯性

这是 PR #142 (ThreadReactor) 确立的模式。`extract.ts`（LLM fallback）已在 #143 中彻底删除——engine 不再持有任何 LLM 依赖。

此外，引擎会拦截 `$status: "$SUSPEND"` 输出（保留状态），在 frontmatter 校验之前单独处理——参见 [[suspend-as-coroutine-yield]]。失败的 step（校验失败、agent 崩溃）也会写入 CAS，记录 `$status: "error"` 和 retry lineage（`previousAttempts`）。
