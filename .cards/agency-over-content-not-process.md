---
title: "Agency over Content, Not Process"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, decision]
category: "architecture"
links:
  - skill-vs-workflow-different-layers
  - deterministic-engine-uncertain-agent
  - feedback-loops-convergent-and-divergent
  - cognitive-process-orchestration
  - uwf-vs-dynamic-workflow
---

uwf 与"agent 自治"方案的核心区别：**agent 对内容有自主权，但对流程没有**。

流程是声明式的、引擎执行的、agent 无法绕过的。agent 不能决定跳过 review，就像程序员不能绕过 CI。自由度被有意限制在"内容"维度，"过程"维度是刚性的。这跟人类组织的逻辑一致——你可以自由发挥怎么写代码，但必须走 PR review。

参见 [[uwf-vs-dynamic-workflow]] 了解与 Claude Code dynamic workflow 的具体对比。
