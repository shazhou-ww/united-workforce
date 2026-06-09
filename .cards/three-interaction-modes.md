---
title: "Three Interaction Modes — Resume, Poke, Ask"
created: "2026-06-09"
source: "xiaonuo-shazhou"
tags: [architecture, concept]
category: "philosophy"
links:
  - suspend-as-coroutine-yield
  - suspend-as-hydrothermal-vent
  - three-learning-carriers
---

UWF 0.4.0 提供了三种 Suspend 后的人机交互模式，构成完整的光谱：

**Resume（继续）**：人给出输入后，AI 从断点继续——协程恢复。`thread resume` 重新运行挂起的角色，人的输入注入为新的上下文。

**Poke（戳一下）**：人直接改写当前步骤的输出，跳过 moderator。`thread poke` 替换而非追加 head step，改写 prev 指针。人的主体性直接覆盖 AI 的输出。

**Ask（追问）**：对历史步骤发起只读提问，不改变线程状态。`step ask` fork 原始 session，从既有经验中提取知识——经验萃取。

三者从"AI 自主运行、人偶尔接力"到"人直接干预、AI 被动响应"，再到"人向 AI 学习、提取可复用知识"，覆盖了人机协作的完整深度。

Ask 的特殊意义：它是 [[suspend-as-hydrothermal-vent]] 中知识蒸馏的核心机制——从 Suspend 点的历史中提取可复用的确定性知识。
