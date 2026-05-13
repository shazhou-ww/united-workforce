import type { WorkflowGraphEdge } from "../../api.ts";

export type NodeState = "default" | "completed" | "active";

export type TerminalKind = "start" | "end";

export type RoleNodeData = {
  label: string;
  description: string;
  state: NodeState;
  [key: string]: unknown;
};

export type TerminalNodeData = {
  kind: TerminalKind;
  state: NodeState;
  [key: string]: unknown;
};

export type ConditionEdgeData = {
  condition: string;
  conditionDescription: string | null;
  isFallback: boolean;
  isFeedback: boolean;
  isSelfLoop: boolean;
  labelX: number | null;
  labelY: number | null;
  [key: string]: unknown;
};

export type GraphInput = {
  edges: readonly WorkflowGraphEdge[];
};
