import type { JSONSchema } from "@ocas/core";

export const CLAUDE_CODE_DETAIL_SCHEMA: JSONSchema = {
  title: "claude-code-detail",
  type: "object",
  required: [
    "sessionId",
    "model",
    "subtype",
    "durationMs",
    "numTurns",
    "totalCostUsd",
    "stopReason",
    "usage",
    "turns",
  ],
  properties: {
    sessionId: { type: "string" },
    model: { type: "string" },
    subtype: { type: "string" },
    durationMs: { type: "integer" },
    numTurns: { type: "integer" },
    totalCostUsd: { type: "number" },
    stopReason: { type: "string" },
    usage: {
      type: "object",
      properties: {
        inputTokens: { type: "integer" },
        outputTokens: { type: "integer" },
        cacheReadInputTokens: { type: "integer" },
        cacheCreationInputTokens: { type: "integer" },
      },
      required: ["inputTokens", "outputTokens", "cacheReadInputTokens", "cacheCreationInputTokens"],
    },
    turns: {
      type: "array",
      items: { type: "string", format: "ocas_ref" },
    },
  },
  additionalProperties: false,
};

export const CLAUDE_CODE_TURN_SCHEMA: JSONSchema = {
  title: "claude-code-turn",
  type: "object",
  required: ["index", "role", "content", "toolCalls"],
  properties: {
    index: { type: "integer" },
    role: { type: "string" },
    content: { type: "string" },
    toolCalls: {},
  },
  additionalProperties: false,
};

export const CLAUDE_CODE_RAW_OUTPUT_SCHEMA: JSONSchema = {
  title: "claude-code-raw-output",
  type: "object",
  required: ["text"],
  properties: {
    text: { type: "string" },
  },
  additionalProperties: false,
};
