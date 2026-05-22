import { useState, useEffect, type ReactNode } from "react";
import FlowEditor, { FlowModel, type WorkFlowSteps } from "../editor/flow.tsx";

const DEFAULT_STEPS: WorkFlowSteps = [
  {
    role: {
      name: "planner",
      description: "分析需求并制定实施计划",
      identity: "你是一位资深的技术架构师",
      prepare: "阅读用户需求，理解项目背景",
      execute: "制定详细的实施计划和步骤分解",
      report: "输出结构化的计划文档，包含步骤列表和预期产出",
    },
    transitions: [{ target: "developer", condition: null }],
  },
  {
    role: {
      name: "developer",
      description: "根据计划编写代码实现",
      identity: "你是一位经验丰富的全栈开发者",
      prepare: "阅读计划文档，理解技术要求",
      execute: "编写高质量的代码实现",
      report: "输出变更文件列表和实现摘要",
    },
    transitions: [{ target: "reviewer", condition: null }],
  },
  {
    role: {
      name: "reviewer",
      description: "审查代码质量并决定是否通过",
      identity: "你是一位严谨的代码审查员",
      prepare: "阅读代码变更和实现摘要",
      execute: "检查代码质量、安全性和最佳实践",
      report: "输出审查结果，包含 approved 状态和评审意见",
    },
    transitions: [
      { target: "END", condition: null },
      { target: "developer", condition: "steps[-1].output.approved = false" },
    ],
  },
];

export function EditorPage(): ReactNode {
  const [model] = useState(() => new FlowModel(DEFAULT_STEPS));

  return (
    <div className="h-full w-full">
      <FlowEditor model={model} />
    </div>
  );
}
