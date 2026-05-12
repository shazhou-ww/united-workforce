import type { LlmProvider } from "@uncaged/workflow-protocol";

export type CursorAgentConfig = {
  model: string | null;
  timeout: number;
  /** Explicit workspace path. When `null`, the agent extracts workspace from AgentContext via a ReAct LLM call. */
  workspace: string | null;
  /** Required when `workspace` is `null` — LLM provider used for workspace extraction. */
  llmProvider: LlmProvider | null;
};
