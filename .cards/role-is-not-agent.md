---
title: "Role Is Not Agent"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, decision]
category: "architecture"
links:
  - session-isolation-as-cognitive-reset
  - process-discipline-from-software-engineering
---

在 uwf 体系里，role ≠ agent。一个 thread 跑的过程中，所有 role 往往由**同一个 agent** 扮演。

Role 对应的是 agent 的 **session**——为了解决一个问题，需要多个 session 从不同角度观察和行动、相互制衡。角色可以在流程中多次重入，重入时**复用**同一个 session（保持角色内记忆连续），隔离发生在角色之间，不是每一步。

这个区分决定了 uwf 的设计不是在做"任务分发给不同 agent"，而是在做**一个 agent 的多视角自我协作**。
