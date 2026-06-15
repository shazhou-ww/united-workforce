export type HermesTurnRole = "assistant" | "tool";

export type HermesToolCall = {
  name: string;
  args: string;
};

export type HermesTurnPayload = {
  index: number;
  role: HermesTurnRole;
  content: string;
  toolCalls: HermesToolCall[] | null;
  reasoning: string | null;
};

export type HermesDetailPayload = {
  sessionId: string;
  model: string;
  duration: number;
  turnCount: number;
  turns: string[];
};

export type HermesSessionToolCall = {
  function: {
    name: string;
    arguments: string;
  };
};

export type HermesSessionMessage = {
  role: string;
  content: string | null;
  tool_calls: HermesSessionToolCall[] | null;
  reasoning: string | null;
};

export type HermesSessionJson = {
  session_id: string;
  model: string;
  session_start: string;
  messages: HermesSessionMessage[];
  inputTokens: number;
  outputTokens: number;
};
