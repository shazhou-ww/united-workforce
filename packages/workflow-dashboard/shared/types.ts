export type WorkFlowRole = {
  name: string;
  description: string;
  identity: string;
  prepare: string;
  execute: string;
  report: string;
};

export type WorkFlowTransition = {
  target: string;
  status: string;
};

export type WorkFlowStep = {
  role: WorkFlowRole;
  transitions: WorkFlowTransition[];
};

export type WorkFlowSteps = WorkFlowStep[];

export type WorkflowSummary = {
  name: string;
  description: string;
};
