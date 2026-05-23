import { describe, expect, test } from "bun:test";

import type { LlmToolCall } from "../src/llm/types.js";

/** Mirror OpenAI response shape for parser coverage via chatCompletionWithTools integration later. */
describe("LlmToolCall shape", () => {
  test("tool call record fields", () => {
    const call: LlmToolCall = {
      id: "call_1",
      name: "read_file",
      arguments: '{"path":"README.md"}',
    };
    expect(call.name).toBe("read_file");
    expect(JSON.parse(call.arguments)).toEqual({ path: "README.md" });
  });
});
