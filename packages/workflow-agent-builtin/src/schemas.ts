import type { JSONSchema } from "@uncaged/json-cas";

const BUILTIN_TOOL_CALL_SCHEMA: JSONSchema = {
  type: "object",
  required: ["name", "args"],
  properties: {
    name: { type: "string" },
    args: { type: "string" },
  },
  additionalProperties: false,
};

export const BUILTIN_TURN_SCHEMA: JSONSchema = {
  title: "builtin-turn",
  type: "object",
  required: ["role", "content"],
  properties: {
    role: { type: "string", enum: ["assistant", "tool"] },
    content: { type: "string" },
    toolCalls: {
      anyOf: [{ type: "array", items: BUILTIN_TOOL_CALL_SCHEMA }, { type: "null" }],
    },
    reasoning: {
      anyOf: [{ type: "string" }, { type: "null" }],
    },
  },
  additionalProperties: false,
};

export const BUILTIN_DETAIL_SCHEMA: JSONSchema = {
  title: "builtin-detail",
  type: "object",
  required: ["sessionId", "model", "duration", "turnCount", "turns"],
  properties: {
    sessionId: { type: "string" },
    model: { type: "string" },
    duration: { type: "integer" },
    turnCount: { type: "integer" },
    turns: {
      type: "array",
      items: { type: "string", format: "cas_ref" },
    },
  },
  additionalProperties: false,
};
