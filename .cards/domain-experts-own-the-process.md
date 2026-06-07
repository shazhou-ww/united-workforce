---
title: "Domain Experts Own the Process"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, decision, pattern]
category: "architecture"
links:
  - trust-chain-audit-evaluate-reuse
  - uwf-vs-dynamic-workflow
  - cognitive-process-orchestration
  - process-discipline-from-software-engineering
---

现实中各行各业有大量由反馈回路构成的流程正在实际运行，掌握和优化这些流程的是行业专家，不是 AI 工程师。

一个资深 QA 负责人知道测试应该怎么分层、失败后应该回到哪一步。一个风控经理知道审批要经过几道关、驳回后应该回到哪个环节补材料。这些人掌握流程的核心知识，但你让他们写 JS 编排脚本，他们做不到也不应该做。

YAML 声明式 workflow 让行业专家能直接参与——看得懂 roles 和 graph，能判断"这个环节是不是多余的"、"这两个角色之间应该加一个校验步骤"。审查门槛低不是为了技术简洁，是为了**让对的人参与对的决策**。

这是可审查 → 可评估 → 可复用信任链能真正转动的前提——转动它的人是行业专家，不是 AI 工程师。也是 uwf 选择声明式 YAML 而非 JS 的根本原因：**流程的设计权应该属于懂流程的人**。
