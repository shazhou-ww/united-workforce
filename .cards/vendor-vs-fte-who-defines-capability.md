---
title: "Vendor vs FTE — Who Defines the Agent's Capability"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, decision]
category: "architecture"
links:
  - agent-as-graduate
  - three-learning-carriers
  - switching-cost-process-knowledge-as-moat
  - opc-why-fte-agents-matter-most
---

区分 vendor 型和 FTE 型 agent 最本质的一条：**谁定义 agent 的能力。**

- **Vendor 型**：开发者定义能力，用户消费能力。能力边界在发布那一刻就定了，升级主动权在开发者。
- **FTE 型**：开发者定义出厂能力（底座模型 + 基础技能包），用户持续定义能力（记忆、skill、workflow）。

出厂是起点不是终点。用户通过积累记忆、训练 skill、设计 workflow，持续塑造 agent 的能力。用得越久，越贴合自己的业务，越不像别人的 agent。

引申的两个特征：
- **成长性** — vendor 的能力随模型升级变化，不随使用积累；FTE 的能力随使用持续积累
- **流程适配性** — vendor 是用户适应工具；FTE 是工具适应用户的业务流程

这也解释了 switching cost 的来源——换掉的不是一个产品，是用户自己定义出来的能力。

代表产品：
- **Vendor 型**：ChatGPT、Claude（对话式）、Midjourney（图像生成）、Perplexity（搜索问答）、各种 GPTs
- **FTE 型**：OpenClaw、Claude Code、Hermes 都在往这个方向走——有记忆、有 skill/workflow 机制、有持续协作关系。但尚未成熟，目前都面向有较深技术能力的用户。真正成熟的 FTE 型产品，应该是行业专家（不懂代码的人）也能带、也能教、也能调优的。这个门槛什么时候降下来，谁先降下来，可能就是这个品类的分水岭。
