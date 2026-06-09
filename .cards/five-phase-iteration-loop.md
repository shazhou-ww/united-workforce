---
title: "Five-Phase Iteration Loop — 五阶自动化迭代循环"
created: "2026-06-09"
source: "xiaonuo-shazhou"
tags: [architecture, pattern]
category: "philosophy"
links:
  - reflective-workflow-self-improvement
  - eval-as-convergence-detector
  - delta-three-dimensions
  - eval-closes-the-trust-chain
---

UWF 的系统优化遵循五阶循环，往复迭代：

```
运行采集 → 分析问题 → 输出方案 → Eval 测评 → 版本发布
   ↑                                              |
   └──────────── 循环往复 ──────────────────────────┘
```

**运行采集**：Workflow 执行过程中，每步的输入输出、人工介入记录、Suspend 原因、资源消耗均被 CAS 持久化。0.4.0 新增失败步骤记录，保留 turns 和 usage 数据，追踪重试谱系（retry lineage）。

**分析问题**：从采集数据中识别瓶颈——高频 Suspend 的角色、反复失败的步骤、人工介入耗时最长的节点。

**输出方案**：基于分析结果给出优化建议——调整 Graph 拓扑、增减 Suspend 点、扩展 Skill 覆盖。

**Eval 测评**：校验优化效果，同时判断流程迭代是否触及天花板。详见 [[eval-as-convergence-detector]]。

**版本发布**：将优化后的 Workflow 发布为新版本，进入下一轮循环。

这是 [[reflective-workflow-self-improvement]] 的具体实施路径——反思不是空想，而是有数据、有评估、有交付的工程实践。每一轮循环都在三个维度上产出增量，参见 [[delta-three-dimensions]]。
