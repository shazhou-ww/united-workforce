---
title: "Open Question — Workflow Granularity and Composition"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, open-question]
category: "architecture"
links:
  - cognitive-process-orchestration
  - skill-vs-workflow-different-layers
  - domain-experts-own-the-process
---

**待讨论。**

Workflow 的粒度问题：solve-issue 是端到端的大 workflow（planner → developer → reviewer → tester → committer），但现实中有些场景只需要管一个环节（比如只用 uwf 管 code review，其他部分用 skill 或手动）。

问题：
- Workflow 是否应该支持嵌套或组合——小 workflow 作为大 workflow 的一个 role？
- 还是粒度完全由用户自己决定，引擎不需要管？
- 组合式 workflow 和单体 workflow 各自的 trade-off 是什么？
