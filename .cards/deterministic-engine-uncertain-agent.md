---
title: "Deterministic Engine, Uncertain Agent"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, decision]
category: "architecture"
links:
  - process-discipline-from-software-engineering
  - session-isolation-as-cognitive-reset
---

uwf 的架构将确定性和不确定性严格分层。

Engine 层（moderator 纯查表、CAS 不可变、每步原子化）是刚性的——流程骨架本身不能成为另一个不可靠的环节。LLM 的不确定性被严格约束在 agent session 内部。

这个选择意味着：调度逻辑完全可预测、可调试、可审计。出问题时你知道问题一定在某个 session 的产出里，不在流程逻辑里。
