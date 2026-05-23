import type { ChatMessage } from "./llm/index.js";

export type BuiltinToolCallRecord = {
  id: string;
  name: string;
  args: string;
};

export type BuiltinToolResultRecord = {
  toolCallId: string;
  name: string;
  content: string;
};

export type BuiltinLoopTurn = {
  assistantContent: string | null;
  toolCalls: BuiltinToolCallRecord[] | null;
  toolResults: BuiltinToolResultRecord[] | null;
};

export type BuiltinSessionState = {
  sessionId: string;
  model: string;
  startedAtMs: number;
  messages: ChatMessage[];
  turns: BuiltinLoopTurn[];
};

export type BuiltinTurnRole = "assistant" | "tool";

export type BuiltinToolCall = {
  name: string;
  args: string;
};

export type BuiltinTurnPayload = {
  index: number;
  role: BuiltinTurnRole;
  content: string;
  toolCalls: BuiltinToolCall[] | null;
  reasoning: string | null;
};

export type BuiltinDetailPayload = {
  sessionId: string;
  model: string;
  duration: number;
  turnCount: number;
  turns: string[];
};
