import type { JSONSchema } from "@ocas/core";

const ROLE_DEFINITION: JSONSchema = {
  type: "object",
  required: ["description", "goal", "capabilities", "procedure", "output", "frontmatter"],
  properties: {
    description: { type: "string" },
    goal: { type: "string" },
    capabilities: { type: "array", items: { type: "string" } },
    procedure: { type: "string" },
    output: { type: "string" },
    frontmatter: { type: "string", format: "ocas_ref" },
  },
  additionalProperties: false,
};

const TARGET: JSONSchema = {
  type: "object",
  required: ["role", "prompt"],
  properties: {
    role: { type: "string", description: "Role name or pseudo-role ($END)" },
    prompt: { type: "string" },
    location: {
      anyOf: [{ type: "string" }, { type: "null" }],
    },
  },
  additionalProperties: false,
};

/**
 * Schema for the engine-level suspend output `{ $status: "$SUSPEND", reason }`.
 * Adapters store suspend outputs against this schema instead of the role's own
 * frontmatter schema, so any role may yield regardless of its declared output.
 */
export const SUSPEND_OUTPUT_SCHEMA: JSONSchema = {
  title: "SuspendOutput",
  type: "object",
  required: ["$status", "reason"],
  properties: {
    $status: { const: "$SUSPEND" },
    reason: { type: "string" },
  },
  additionalProperties: false,
};

export const WORKFLOW_SCHEMA: JSONSchema = {
  title: "Workflow",
  type: "object",
  required: ["version", "name", "description", "roles", "graph"],
  properties: {
    version: { type: "integer" },
    name: { type: "string" },
    description: { type: "string" },
    roles: {
      type: "object",
      additionalProperties: ROLE_DEFINITION,
    },
    graph: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: TARGET,
      },
    },
  },
  additionalProperties: false,
};

export const START_NODE_SCHEMA: JSONSchema = {
  title: "StartNode",
  type: "object",
  required: ["workflow", "prompt", "cwd"],
  properties: {
    workflow: { type: "string", format: "ocas_ref" },
    prompt: { type: "string" },
    cwd: { type: "string" },
  },
  additionalProperties: false,
};

export const STEP_NODE_SCHEMA: JSONSchema = {
  title: "StepNode",
  type: "object",
  required: [
    "start",
    "prev",
    "role",
    "output",
    "detail",
    "agent",
    "startedAtMs",
    "completedAtMs",
    "cwd",
  ],
  properties: {
    start: { type: "string", format: "ocas_ref" },
    prev: {
      anyOf: [{ type: "string", format: "ocas_ref" }, { type: "null" }],
    },
    role: { type: "string" },
    output: { type: "string", format: "ocas_ref" },
    detail: { type: "string", format: "ocas_ref" },
    agent: { type: "string" },
    edgePrompt: { type: "string" },
    startedAtMs: { type: "integer" },
    completedAtMs: { type: "integer" },
    cwd: { type: "string" },
    assembledPrompt: {
      anyOf: [{ type: "string", format: "ocas_ref" }, { type: "null" }],
    },
    usage: {
      anyOf: [
        {
          type: "object",
          required: ["turns", "inputTokens", "outputTokens", "duration"],
          properties: {
            turns: { type: "integer" },
            inputTokens: { type: "integer" },
            outputTokens: { type: "integer" },
            duration: { type: "number" },
          },
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    previousAttempts: {
      anyOf: [{ type: "array", items: { type: "string", format: "ocas_ref" } }, { type: "null" }],
    },
  },
  additionalProperties: false,
};

/**
 * Output schema for failed agent steps — written to CAS so failed step nodes
 * can carry a structured `output` ref (with `$status: "error"`) for moderator
 * inspection and dashboard rendering. Failed steps are NEVER advanced to thread
 * head; they are linked from the eventual successful step via `previousAttempts`.
 */
export const ERROR_OUTPUT_SCHEMA: JSONSchema = {
  title: "ErrorOutput",
  type: "object",
  required: ["$status", "error"],
  properties: {
    $status: { type: "string", const: "error" },
    error: { type: "string" },
    phase: { type: "string" },
  },
  additionalProperties: false,
};

// ── Turn Chain Schemas (Phase 1) ────────────────────────────────────

/**
 * Schema for step initiation markers — written before agent spawn.
 * Forms a singly-linked chain via `prev` for step ordering within a thread.
 */
export const STEP_START_SCHEMA: JSONSchema = {
  title: "StepStart",
  type: "object",
  required: ["role", "edgePrompt", "stepIndex", "prev", "start", "startedAtMs", "cwd"],
  properties: {
    role: { type: "string" },
    edgePrompt: { type: "string" },
    stepIndex: { type: "integer" },
    prev: {
      anyOf: [{ type: "string", format: "ocas_ref" }, { type: "null" }],
    },
    start: { type: "string", format: "ocas_ref" },
    startedAtMs: { type: "integer" },
    cwd: { type: "string" },
  },
  additionalProperties: false,
};

/**
 * Schema for step completion records — written after agent returns.
 * Links back to its step-start via `startRef`.
 */
export const STEP_COMPLETE_SCHEMA: JSONSchema = {
  title: "StepComplete",
  type: "object",
  required: ["startRef", "output", "detail", "completedAtMs", "usage", "previousAttempts"],
  properties: {
    startRef: { type: "string", format: "ocas_ref" },
    output: { type: "string", format: "ocas_ref" },
    detail: { type: "string", format: "ocas_ref" },
    completedAtMs: { type: "integer" },
    usage: {
      anyOf: [
        {
          type: "object",
          required: ["turns", "inputTokens", "outputTokens", "duration"],
          properties: {
            turns: { type: "integer" },
            inputTokens: { type: "integer" },
            outputTokens: { type: "integer" },
            duration: { type: "number" },
          },
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    previousAttempts: {
      anyOf: [{ type: "array", items: { type: "string", format: "ocas_ref" } }, { type: "null" }],
    },
  },
  additionalProperties: false,
};

/**
 * Schema for turn nodes — forms a singly-linked chain via `prev`.
 * Each turn belongs to a step-start via `owner`.
 */
export const TURN_NODE_SCHEMA: JSONSchema = {
  title: "TurnNode",
  type: "object",
  required: ["role", "content", "prev", "owner"],
  properties: {
    role: { type: "string" },
    content: { type: "string" },
    prev: {
      anyOf: [{ type: "string", format: "ocas_ref" }, { type: "null" }],
    },
    owner: {
      anyOf: [{ type: "string", format: "ocas_ref" }, { type: "null" }],
    },
  },
  additionalProperties: false,
};
