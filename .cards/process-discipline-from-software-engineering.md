---
title: "Process Discipline from Software Engineering"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, pattern, decision]
category: "architecture"
links:
  - session-isolation-as-cognitive-reset
  - role-is-not-agent
  - dissipative-structure-token-for-entropy
  - deterministic-engine-uncertain-agent
---

uwf 的发心是将人类软件工程的流程纪律应用到 AI agent 上。

人类早已验证：个体不可靠，但流程可以让不可靠的个体组成可靠的系统。Code review 不是因为不信任程序员，而是**写代码和审代码是两种认知模式**，一个人很难同时做好。测试、灰度、回滚——每一层都是在用额外成本换确定性。

uwf 把这套搬过来：planner 和 reviewer 可以是同一个 agent，但流程迫使它在不同 session 里切换视角，形成自我制衡。用 role 和 role 之间的流转关系，**把做一件事的步骤固定下来**。

PR #148 vs #142 是直接证据——不是换了更强的 agent，是同样的 agent，换了协作结构。
