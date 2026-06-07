---
title: "Feedback Loops — Convergent and Divergent"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, pattern]
category: "architecture"
links:
  - dissipative-structure-token-for-entropy
  - process-discipline-from-software-engineering
  - cognitive-process-orchestration
---

uwf 的 graph 环路不限于负反馈（收敛），也可以是正反馈（发散）。引擎本身不带倾向——流转方向由 `$status` 和 graph 决定，反馈性质由 role 的设计意图决定。

**负反馈环（收敛）**：developer → reviewer → rejected → developer。reviewer 的 goal 是"找问题"，产生修正力。稳定点是 `approved`，系统自然收敛到那里。特性：偏差越大修正越强，对扰动鲁棒。

**正反馈环（发散）**：proposer → challenger → "interesting" → proposer。challenger 的 goal 是"追问更深层的假设"，每轮发散，一个想法激发更多想法。

终止条件不同：负反馈靠收敛自然到达稳定点；正反馈不会自己停，需要外部约束（轮次上限，或额外 role 判断"够了"）。

每个 role 的 `$status` 就是误差信号（负反馈）或激励信号（正反馈），驱动系统向不同方向演化。Workflow author 真正在设计的是**在哪里放什么样的环**。
