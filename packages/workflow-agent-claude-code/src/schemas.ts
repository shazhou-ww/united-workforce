import type { JSONSchema } from "@uncaged/json-cas";

export const CLAUDE_CODE_DETAIL_SCHEMA: JSONSchema = {
  title: "claude-code-detail",
  type: "object",
  required: ["sessionId", "numTurns", "totalCostUsd", "durationMs", "subtype"],
  properties: {
    sessionId: { type: "string" },
    numTurns: { type: "integer" },
    totalCostUsd: { type: "number" },
    durationMs: { type: "integer" },
    subtype: { type: "string" },
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
