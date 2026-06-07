---
title: "Open Question — Human as Role Participant"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, open-question]
category: "architecture"
links:
  - agent-as-graduate
  - opc-why-fte-agents-matter-most
  - role-is-not-agent
  - process-authorship-human-ai-vs-delegation
---

**待讨论。**

目前讨论主要围绕 OPC（一个人 + N 个 agent）。但小团队场景下——几个人各自有 FTE agent，共享 workflow 库和记忆——workflow 的某些 role 可能需要人来执行而不是 agent。

问题：
- uwf 是否需要支持人作为 role 的参与者（比如"人工审批"作为 graph 中的一个 role）？
- 还是人永远在 workflow 之外，只做设计者和监督者？
- 如果支持，$SUSPEND 机制是否已经覆盖了这个需求（暂停等人介入）？
- 多人 + 多 agent 的协作场景下，workflow 的共享和权限模型是什么样的？
