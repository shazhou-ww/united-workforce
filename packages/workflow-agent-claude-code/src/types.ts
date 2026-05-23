export type ClaudeCodeResultSubtype = "success" | "error_max_turns" | "error_budget";

/** A single tool call within an assistant turn. */
export type ClaudeCodeToolCall = {
  name: string;
  input: string;
};

/** A single turn (assistant text, tool use, or tool result). */
export type ClaudeCodeTurnPayload = {
  index: number;
  role: "assistant" | "tool_result";
  content: string;
  toolCalls: ClaudeCodeToolCall[] | null;
};

/** Top-level detail stored as CAS node. */
export type ClaudeCodeDetailPayload = {
  sessionId: string;
  model: string;
  subtype: string;
  durationMs: number;
  numTurns: number;
  totalCostUsd: number;
  stopReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  };
  turns: string[]; // CAS hashes of ClaudeCodeTurnPayload
};

/** Intermediate parsed result from stream-json output. */
export type ClaudeCodeParsedResult = {
  type: string;
  subtype: ClaudeCodeResultSubtype;
  result: string;
  sessionId: string;
  numTurns: number;
  totalCostUsd: number;
  durationMs: number;
  model: string;
  stopReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  };
  turns: ClaudeCodeTurnPayload[];
};
