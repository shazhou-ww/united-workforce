---
title: "Skill vs Workflow — Different Layers"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, decision]
category: "architecture"
links:
  - session-isolation-as-cognitive-reset
  - cognitive-process-orchestration
  - agency-over-content-not-process
---

Skill 和 workflow 不是替代关系，是不同层次。

**Skill** 管的是一个 session 内怎么做——给 agent 的指令和方法论。你可以在 skill 里写"先规划再编码再 review"，但 agent 始终在同一个 session 里，review 自己刚写的代码时带着全部决策记忆。确认偏误无法靠 prompt 消除。

**Workflow** 管的是 session 之间怎么协作——强制 session 断裂，reviewer 进来时不知道 developer 当时为什么做那个选择，只看到产出物。这个隔离不是靠自律，是靠结构。

两者正交：workflow 的每个 role 里面完全可以加载 skill。Skill 提升单个 session 的能力，workflow 编排多个 session 的协作关系。
