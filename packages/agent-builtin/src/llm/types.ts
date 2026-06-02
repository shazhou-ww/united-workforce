export type LlmToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type LlmAssistantResponse = {
  content: string | null;
  toolCalls: LlmToolCall[] | null;
};

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls: LlmToolCall[] | null;
    }
  | { role: "tool"; tool_call_id: string; content: string };

export type OpenAiToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};
