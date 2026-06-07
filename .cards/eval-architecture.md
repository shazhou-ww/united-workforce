---
title: "Eval Architecture — Task + Judge + CAS"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, decision]
category: "architecture"
links:
  - eval-closes-the-trust-chain
  - agent-cli-protocol
  - frontmatter-fast-path
---

uwf-eval 的三层架构：

1. **Task = 可分发的评估单元**（task.yaml + fixture 目录 + judge 脚本）。定义 prompt、workflow 引用、limits、judges 列表及权重。
2. **Judge = 独立评分脚本**。`node <entry> <cwd> <thread-id>`，stdout 输出 `{score, data}` JSON。分 builtin（frontmatter 合规、upstream 消费、幻觉检测、token 统计）和 task-specific 两类。
3. **CAS 存储**：每次 eval run 的结果是 OCAS typed node，支持 diff 对比不同 run。

关键设计：uwf-eval **不是 uwf 的一部分**——它作为独立包 shell out 到 uwf CLI，保持解耦。Judge 之间独立，可并行执行。

四个 builtin judges：
- `frontmatter` — 确定性校验，每步 frontmatter 是否合规
- `upstream` — LLM-as-judge，上游信息是否被消费
- `hallucination` — LLM-as-judge，是否有幻觉
- `token-stats` — 信息性指标，不参与评分
