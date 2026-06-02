import type { JSONSchema } from "@ocas/core";

const HERMES_TOOL_CALL_SCHEMA: JSONSchema = {
  type: "object",
  required: ["name", "args"],
  properties: {
    name: { type: "string" },
    args: { type: "string" },
  },
  additionalProperties: false,
};

export const HERMES_TURN_SCHEMA: JSONSchema = {
  title: "hermes-turn",
  type: "object",
  required: ["index", "role", "content"],
  properties: {
    index: { type: "integer" },
    role: { type: "string", enum: ["assistant", "tool"] },
    content: { type: "string" },
    toolCalls: {
      anyOf: [{ type: "array", items: HERMES_TOOL_CALL_SCHEMA }, { type: "null" }],
    },
    reasoning: {
      anyOf: [{ type: "string" }, { type: "null" }],
    },
  },
  additionalProperties: false,
};

export const HERMES_DETAIL_SCHEMA: JSONSchema = {
  title: "hermes-detail",
  type: "object",
  required: ["sessionId", "model", "duration", "turnCount", "turns"],
  properties: {
    sessionId: { type: "string" },
    model: { type: "string" },
    duration: { type: "integer" },
    turnCount: { type: "integer" },
    turns: {
      type: "array",
      items: { type: "string", format: "ocas_ref" },
    },
  },
  additionalProperties: false,
};

/** Fallback detail when Hermes session file is unavailable. */
export const HERMES_RAW_OUTPUT_SCHEMA: JSONSchema = {
  title: "hermes-raw-output",
  type: "object",
  required: ["text"],
  properties: {
    text: { type: "string" },
  },
  additionalProperties: false,
};
