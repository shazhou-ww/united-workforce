import type { Store } from "@uncaged/json-cas";
import type { ModeratorContext, ThreadId, WorkflowPayload } from "@uncaged/uwf-protocol";

export type AgentContext = ModeratorContext & {
  threadId: ThreadId;
  role: string;
  store: Store;
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
