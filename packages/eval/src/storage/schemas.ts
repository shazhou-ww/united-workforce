import type { JSONSchema } from "@ocas/core";

export const EVAL_RUN_SCHEMA: JSONSchema = {
  title: "@uwf/eval-run",
  type: "object",
  required: ["task", "config", "threadId", "judges", "overall", "timestamp"],
  properties: {
    task: { type: "string" },
    config: {
      type: "object",
      required: ["agent", "model", "engineVersion"],
      properties: {
        agent: { type: "string" },
        model: { type: "string" },
        engineVersion: { type: "string" },
      },
    },
    threadId: { type: "string" },
    judges: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "score", "weight", "dataHash"],
        properties: {
          name: { type: "string" },
          score: { type: "number" },
          weight: { type: "number" },
          dataHash: { type: "string" },
        },
      },
    },
    overall: { type: "number" },
    timestamp: { type: "integer" },
  },
};

export const EVAL_JUDGE_FRONTMATTER_SCHEMA: JSONSchema = {
  title: "@uwf/eval-judge-frontmatter",
  type: "object",
  required: ["stepsTotal", "stepsValid", "invalidSteps"],
  properties: {
    stepsTotal: { type: "integer" },
    stepsValid: { type: "integer" },
    invalidSteps: {
      type: "array",
      items: {
        type: "object",
        required: ["stepIndex", "role", "errors"],
        properties: {
          stepIndex: { type: "integer" },
          role: { type: "string" },
          errors: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

export const EVAL_JUDGE_UPSTREAM_SCHEMA: JSONSchema = {
  title: "@uwf/eval-judge-upstream",
  type: "object",
  required: ["perStep"],
  properties: {
    perStep: {
      type: "array",
      items: {
        type: "object",
        required: ["role", "consumed", "missed", "score"],
        properties: {
          role: { type: "string" },
          consumed: { type: "array", items: { type: "string" } },
          missed: { type: "array", items: { type: "string" } },
          score: { type: "number" },
        },
      },
    },
  },
};

export const EVAL_JUDGE_HALLUCINATION_SCHEMA: JSONSchema = {
  title: "@uwf/eval-judge-hallucination",
  type: "object",
  required: ["perStep"],
  properties: {
    perStep: {
      type: "array",
      items: {
        type: "object",
        required: ["role", "hallucinations", "score"],
        properties: {
          role: { type: "string" },
          hallucinations: { type: "array", items: { type: "string" } },
          score: { type: "number" },
        },
      },
    },
  },
};

export const EVAL_JUDGE_TOKEN_STATS_SCHEMA: JSONSchema = {
  title: "@uwf/eval-judge-token-stats",
  type: "object",
  required: ["totalInput", "totalOutput", "totalTurns", "perStep"],
  properties: {
    totalInput: { type: "integer" },
    totalOutput: { type: "integer" },
    totalTurns: { type: "integer" },
    perStep: {
      type: "array",
      items: {
        type: "object",
        required: ["role", "inputTokens", "outputTokens", "turns", "duration"],
        properties: {
          role: { type: "string" },
          inputTokens: { type: "integer" },
          outputTokens: { type: "integer" },
          turns: { type: "integer" },
          duration: { type: "number" },
        },
      },
    },
  },
};
