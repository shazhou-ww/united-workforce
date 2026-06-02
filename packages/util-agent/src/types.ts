import type { Store } from "@ocas/core";
import type { ModeratorContext, ThreadId, WorkflowPayload } from "@united-workforce/protocol";

export type AgentContext = ModeratorContext & {
  threadId: ThreadId;
  role: string;
  store: Store;
  workflow: WorkflowPayload;
  /**
   * Prepend to the role's prompt when building the agent prompt.
   * Contains the frontmatter deliverable format instruction derived from the
   * role's output schema.  Populated by `createAgent` at run time.
   */
  outputFormatInstruction: string;
  /**
   * Edge prompt from the graph transition that led to this role (--prompt CLI arg).
   * Always the real moderator instruction for this step.
   */
  edgePrompt: string;
  /**
   * True when the current role has not appeared in steps history before this invocation.
   */
  isFirstVisit: boolean;
};

export type AgentRunResult = {
  output: string;
  detailHash: string;
  sessionId: string;
  /** The fully assembled prompt that was sent to the agent. */
  assembledPrompt: string;
};

export type AgentContinueFn = (
  sessionId: string,
  message: string,
  store: AgentContext["store"],
) => Promise<AgentRunResult>;

export type AgentRunFn = (ctx: AgentContext) => Promise<AgentRunResult>;

export type AdapterOutput = {
  stepHash: string;
  detailHash: string;
  role: string;
  frontmatter: Record<string, unknown>;
  body: string;
  startedAtMs: number;
  completedAtMs: number;
};

export type AgentOptions = {
  name: string;
  run: AgentRunFn;
  continue: AgentContinueFn;
};
