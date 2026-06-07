---
title: "Session Isolation as Cognitive Reset"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, decision, pattern]
category: "architecture"
links:
  - role-is-not-agent
  - dissipative-structure-token-for-entropy
  - process-discipline-from-software-engineering
---

uwf 的核心机制不是"多 agent 协调"，而是**用 session 隔离实现视角切换**。

同一个 agent 以不同 role 进入时，得到的是全新的认知上下文——没有惯性、没有确认偏误。CAS 链传递工作成果，但认知状态是重置的。Role 定义（goal、procedure、output schema）塑造每个 session 的关注点和行为边界。

这解释了为什么 stateless 单步设计这么重要：engine 确保每次角色切换都是一个干净的 session 入口。
