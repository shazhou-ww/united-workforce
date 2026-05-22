import type { JSONSchema } from "@uncaged/json-cas";

const ROLE_DEFINITION: JSONSchema = {
  type: "object",
  required: ["description", "goal", "capabilities", "procedure", "output", "meta"],
  properties: {
    description: { type: "string" },
    goal: { type: "string" },
    capabilities: { type: "array", items: { type: "string" } },
    procedure: { type: "string" },
    output: { type: "string" },
    meta: { type: "string", format: "cas_ref" },
  },
  additionalProperties: false,
};

const CONDITION_DEFINITION: JSONSchema = {
  type: "object",
  required: ["description", "expression"],
  properties: {
    description: { type: "string" },
    expression: { type: "string" },
  },
  additionalProperties: false,
};

const TRANSITION: JSONSchema = {
  type: "object",
  required: ["role", "condition"],
  properties: {
    role: { type: "string" },
    condition: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  additionalProperties: false,
};

export const WORKFLOW_SCHEMA: JSONSchema = {
  title: "Workflow",
  type: "object",
  required: ["name", "description", "roles", "conditions", "graph"],
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    roles: {
      type: "object",
      additionalProperties: ROLE_DEFINITION,
    },
    conditions: {
      type: "object",
      additionalProperties: CONDITION_DEFINITION,
    },
    graph: {
      type: "object",
      additionalProperties: {
        type: "array",
        items: TRANSITION,
      },
    },
  },
  additionalProperties: false,
};

export const START_NODE_SCHEMA: JSONSchema = {
  title: "StartNode",
  type: "object",
  required: ["workflow", "prompt"],
  properties: {
    workflow: { type: "string", format: "cas_ref" },
    prompt: { type: "string" },
  },
  additionalProperties: false,
};

export const STEP_NODE_SCHEMA: JSONSchema = {
  title: "StepNode",
  type: "object",
  required: ["start", "prev", "role", "output", "detail", "agent"],
  properties: {
    start: { type: "string", format: "cas_ref" },
    prev: {
      anyOf: [{ type: "string", format: "cas_ref" }, { type: "null" }],
    },
    role: { type: "string" },
    output: { type: "string", format: "cas_ref" },
    detail: { type: "string", format: "cas_ref" },
    agent: { type: "string" },
  },
  additionalProperties: false,
};
