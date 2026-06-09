---
title: "Suspend as Coroutine Yield — 从自动化到人机接力"
created: "2026-06-09"
source: "xiaonuo-shazhou"
tags: [architecture, philosophy, concept]
category: "philosophy"
links:
  - deterministic-engine-uncertain-agent
  - status-based-moderator
  - three-interaction-modes
  - suspend-as-hydrothermal-vent
---

UWF 0.4.0 将 `$SUSPEND` 从图论伪角色提升为引擎级保留状态——协程让出（coroutine yield）。

技术实现：任何角色可以在输出中发射 `{ $status: "$SUSPEND", reason: string }`，引擎在 moderator 之前拦截，step 正常写入 CAS（head 前进），线程挂起，等待 `thread resume` 重新运行同一角色。

**哲学意义**：这不只是功能，而是系统哲学的关键转折——流程从"单向自动跑完"变成"人机可接力协作"。AI 承接确定性流程，人在 Suspend 节点处理未知与关键决策。

协程隐喻的核心：人和 AI 各自是一个协程，在 Suspend 点交接控制权，各自在自己的上下文里运行。不是中断，是**让出**——等待对方输入后恢复。

参见 [[three-interaction-modes]] 了解 Suspend 后的三种人机交互模式。
