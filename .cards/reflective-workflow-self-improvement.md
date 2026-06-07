---
title: "Reflective Workflow — Self-Improvement as Discipline"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, pattern, decision]
category: "architecture"
links:
  - eval-closes-the-trust-chain
  - three-learning-carriers
  - workflow-as-improvable-system
  - feedback-loops-convergent-and-divergent
  - trust-chain-audit-evaluate-reuse
---

FTE agent 的"成长"不靠自发顿悟，靠纪律性的反思。反思本身是纪律性的（定期跑、不能跳过、有固定步骤），所以应该用 workflow 承载——不能靠 agent "有空想想"。

反思 workflow 定期拉取最近执行过的任务，分析流程中出现的问题，找可优化的点，迭代，eval，对比。反思的对象覆盖三层载体：

- 发现某个 role 反复在同一类问题上出错 → **迭代 skill**
- 发现某类任务的上下文总是缺少关键信息 → **补充记忆**
- 发现某个审批环节通过率 100% 从未驳回 → **简化 workflow**

这形成了双层 workflow 架构：

```
执行层：workflow 驱动日常任务
    ↓ 产出执行记录（CAS 链）
反思层：反思 workflow 定期分析执行记录
    ↓ 产出改进建议
改进层：迭代 memory / skill / workflow
    ↓ 提升下一轮执行质量
执行层：...
```

两层都是 workflow，职责不同——执行层做事，反思层改进做事的方式。用 workflow 来优化 workflow——工具改进自身的递归。
