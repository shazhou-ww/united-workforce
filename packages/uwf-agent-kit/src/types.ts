import type { StepContext, ThreadId, WorkflowPayload } from "@uncaged/uwf-protocol";

export type AgentContext = {
  threadId: ThreadId;
  role: string;
  systemPrompt: string;
  prompt: string;
  history: StepContext[];
  workflow: WorkflowPayload;
};

export type AgentRunFn = (ctx: AgentContext) => Promise<string>;

export type AgentOptions = {
  name: string;
  run: AgentRunFn;
};
