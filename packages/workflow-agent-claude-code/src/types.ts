export type ClaudeCodeResultSubtype = "success" | "error_max_turns" | "error_budget";

export type ClaudeCodeParsedResult = {
  type: string;
  subtype: ClaudeCodeResultSubtype;
  result: string;
  sessionId: string;
  numTurns: number;
  totalCostUsd: number;
  durationMs: number;
};

export type ClaudeCodeDetailPayload = {
  sessionId: string;
  numTurns: number;
  totalCostUsd: number;
  durationMs: number;
  subtype: string;
};
