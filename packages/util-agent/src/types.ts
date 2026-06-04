import type { Store } from "@ocas/core";
import type {
  ModeratorContext,
  ThreadId,
  Usage,
  WorkflowPayload,
} from "@united-workforce/protocol";

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
  /** Resolved uwf storage root (from `UWF_HOME`), threaded from the CLI entry point. */
  storageRoot: string;
  /** Resolved global CAS directory (from `OCAS_HOME`), threaded from the CLI entry point. */
  casDir: string;
};

export type AgentRunResult = {
  output: string;
  detailHash: string;
  sessionId: string;
  /** The fully assembled prompt that was sent to the agent. */
  assembledPrompt: string;
  /** Token usage statistics for this run. null when the adapter does not report usage. */
  usage: Usage | null;
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
  usage: Usage | null;
};

export type AgentOptions = {
  name: string;
  run: AgentRunFn;
  continue: AgentContinueFn;
};
