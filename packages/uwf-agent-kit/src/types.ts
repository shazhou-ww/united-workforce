import type { StepContext, ThreadId, WorkflowPayload } from "@uncaged/uwf-protocol";

export type AgentContext = {
  threadId: ThreadId;
  role: string;
  systemPrompt: string;
  prompt: string;
  history: StepContext[];
  workflow: WorkflowPayload;
};

export type AgentRunResult = {
  output: string;
  detailHash: string;
};

export type AgentRunFn = (ctx: AgentContext) => Promise<AgentRunResult>;

export type AgentOptions = {
  name: string;
  run: AgentRunFn;
};
