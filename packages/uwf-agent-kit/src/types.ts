import type { Store } from "@uncaged/json-cas";
import type { ModeratorContext, ThreadId, WorkflowPayload } from "@uncaged/uwf-protocol";

export type AgentContext = ModeratorContext & {
  threadId: ThreadId;
  role: string;
  store: Store;
  workflow: WorkflowPayload;
  /**
   * Prepend to the role's systemPrompt when building the agent prompt.
   * Contains the frontmatter deliverable format instruction derived from the
   * role's output schema.  Populated by `createAgent` at run time.
   */
  outputFormatInstruction: string;
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
