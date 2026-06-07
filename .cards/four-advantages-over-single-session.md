---
title: "Four Advantages over Single Session + Skill"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, pattern]
category: "architecture"
links:
  - session-isolation-as-cognitive-reset
  - attention-isolation-breaks-cognitive-inertia
  - skill-vs-workflow-different-layers
  - when-skill-is-not-enough
---

Session 隔离除了认知层面的好处（打破确认偏误、聚焦注意力），还解决一个更物理性的问题：**长 session 的上下文压缩导致降智和行为不稳定**。

Context window 是有限资源。一个 session 从头做到尾，前期的 tool output、中间的思考过程不断堆积，要么触发 compaction（信息丢失），要么挤占后期推理的有效空间。越到后面 agent 越"笨"——不是能力变了，是可用的认知空间被历史占满了。表现为：忘记约束、重复错误、输出不稳定。

Session 隔离直接解决这个问题：每个 role 进入时拿到的是**精炼过的前序产出**（CAS 里经 schema 过滤的结构化 output），不是前面所有 session 的原始 token 流。信息经过 schema 过滤，只有产出物，没有过程噪声。

uwf 相对单 session + skill 的四个优势，前三个来自 session 隔离，第四个来自程序化流程：

1. **认知隔离** — 打破确认偏误和线性思维惯性
2. **注意力聚焦** — 每个 role 只看该看的信息
3. **上下文保鲜** — 避免长 session 的压缩降智和行为漂移
4. **流程可靠性** — 引擎强制执行每一步，agent 无法跳过或篡改流程

前三点回答"为什么拆成多个 session 更好"，第四点回答"为什么流程要由引擎控制而不是 agent 自觉"。Skill 里写"先编码再测试再 review"，agent 可能做着做着就跳过——不是故意的，是 context 压力下行为漂移，或者觉得"改动太小不需要测试"。程序化流程不存在这个问题：graph 说要走 tester，就必须走 tester。
