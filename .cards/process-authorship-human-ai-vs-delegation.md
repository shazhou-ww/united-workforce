---
title: "Process Authorship — Human-AI Collaboration vs Full Delegation"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, decision]
category: "architecture"
links:
  - domain-experts-own-the-process
  - uwf-vs-dynamic-workflow
  - trust-chain-audit-evaluate-reuse
  - workflow-as-improvable-system
---

dw 和 uwf 都面向 agent，用户都不需要会写代码。区别在于**流程的创作权**：

- **dw**：流程由 AI 全权负责。用户描述任务，agent 决定怎么拆步骤、怎么编排。用户参与度最低，门槛最低。
- **uwf**：流程创作是人和 AI 协作的。行业专家参与设计、审查、调优流程，agent 参与起草和执行。

这是主动权的取舍。dw 把流程交给 AI 是为了降低使用门槛；uwf 有意保留人对流程的参与权，代价是门槛稍高，收益是流程能融入人的领域知识。

背后的认知：**AI 擅长执行，但流程设计需要领域知识。** AI 不知道行业里哪个环节容易出错、哪个审批不能跳过、哪个反馈回路是血的教训换来的。这些知识在行业专家脑子里，需要一个他们能参与的载体来表达。

dw 赌的是 AI 能自己发现好的流程，uwf 赌的是好的流程需要人的知识参与。两个赌注没有对错，适用于不同的场景：临时任务用 dw 的零门槛更高效，反复执行的核心业务流程用 uwf 的人机协作更可靠。
