import type { JSONSchema } from "@ocas/core";

/**
 * JSON Schemas for every uwf CLI command output, registered in CAS under
 * `@uwf/output/<short-name>`. The CLI envelopes payloads as
 * `{ type: <schemaHash>, value: <payload> }` so output is self-describing
 * and pipeable into `ocas render -p`.
 *
 * All schemas use `additionalProperties: false` so unknown fields are caught
 * at the envelope-construction boundary.
 */

const NULLABLE_STRING: JSONSchema = {
  anyOf: [{ type: "string" }, { type: "null" }],
};

const NULLABLE_INTEGER: JSONSchema = {
  anyOf: [{ type: "integer" }, { type: "null" }],
};

const THREAD_STATUS_VALUES = [
  "idle",
  "running",
  "suspended",
  "end",
  "cancelled",
  "corrupt",
] as const;

export const THREAD_START_OUTPUT_SCHEMA: JSONSchema = {
  title: "@uwf/output/thread-start",
  type: "object",
  required: ["threadId", "workflowHash"],
  properties: {
    threadId: { type: "string" },
    workflowHash: { type: "string" },
  },
  additionalProperties: false,
};

export const THREAD_STATUS_OUTPUT_SCHEMA: JSONSchema = {
  title: "@uwf/output/thread-status",
  type: "object",
  required: [
    "threadId",
    "workflowHash",
    "head",
    "status",
    "currentRole",
    "suspendedRole",
    "suspendMessage",
    "done",
  ],
  properties: {
    threadId: { type: "string" },
    workflowHash: { type: "string" },
    head: NULLABLE_STRING,
    status: { type: "string", enum: [...THREAD_STATUS_VALUES] },
    currentRole: NULLABLE_STRING,
    suspendedRole: NULLABLE_STRING,
    suspendMessage: NULLABLE_STRING,
    done: { type: "boolean" },
  },
  additionalProperties: false,
};

const THREAD_LIST_ITEM: JSONSchema = {
  type: "object",
  required: [
    "threadId",
    "workflowHash",
    "workflowName",
    "status",
    "currentRole",
    "startedAt",
    "completedAt",
  ],
  properties: {
    threadId: { type: "string" },
    workflowHash: { type: "string" },
    workflowName: NULLABLE_STRING,
    status: { type: "string", enum: [...THREAD_STATUS_VALUES] },
    currentRole: NULLABLE_STRING,
    startedAt: NULLABLE_INTEGER,
    completedAt: NULLABLE_INTEGER,
  },
  additionalProperties: false,
};

export const THREAD_LIST_OUTPUT_SCHEMA: JSONSchema = {
  title: "@uwf/output/thread-list",
  type: "object",
  required: ["items"],
  properties: {
    items: { type: "array", items: THREAD_LIST_ITEM },
  },
  additionalProperties: false,
};

const THREAD_EXEC_STEP_ITEM: JSONSchema = {
  type: "object",
  required: ["head", "status", "currentRole", "done", "role", "suspendedRole", "suspendMessage"],
  properties: {
    head: { type: "string" },
    status: { type: "string", enum: [...THREAD_STATUS_VALUES] },
    currentRole: NULLABLE_STRING,
    done: { type: "boolean" },
    role: NULLABLE_STRING,
    suspendedRole: NULLABLE_STRING,
    suspendMessage: NULLABLE_STRING,
  },
  additionalProperties: false,
};

export const THREAD_EXEC_OUTPUT_SCHEMA: JSONSchema = {
  title: "@uwf/output/thread-exec",
  type: "object",
  required: ["threadId", "workflowHash", "steps"],
  properties: {
    threadId: { type: "string" },
    workflowHash: { type: "string" },
    steps: { type: "array", items: THREAD_EXEC_STEP_ITEM },
  },
  additionalProperties: false,
};

const STEP_DETAIL_TURN: JSONSchema = {
  type: "object",
  required: ["role", "content", "timestamp"],
  properties: {
    role: { type: "string" },
    content: { type: "string" },
    timestamp: NULLABLE_INTEGER,
  },
  additionalProperties: true,
};

export const STEP_DETAIL_OUTPUT_SCHEMA: JSONSchema = {
  title: "@uwf/output/step-detail",
  type: "object",
  required: [
    "hash",
    "role",
    "agent",
    "status",
    "startedAtMs",
    "completedAtMs",
    "durationMs",
    "frontmatter",
    "turns",
  ],
  properties: {
    hash: { type: "string" },
    role: { type: "string" },
    agent: { type: "string" },
    status: { type: "string" },
    startedAtMs: NULLABLE_INTEGER,
    completedAtMs: NULLABLE_INTEGER,
    durationMs: NULLABLE_INTEGER,
    frontmatter: { type: "object", additionalProperties: true },
    turns: { type: "array", items: STEP_DETAIL_TURN },
  },
  additionalProperties: false,
};

const STEP_LIST_ITEM: JSONSchema = {
  type: "object",
  required: ["hash", "role", "durationMs"],
  properties: {
    hash: { type: "string" },
    role: { type: "string" },
    durationMs: NULLABLE_INTEGER,
  },
  additionalProperties: false,
};

export const STEP_LIST_OUTPUT_SCHEMA: JSONSchema = {
  title: "@uwf/output/step-list",
  type: "object",
  required: ["threadId", "items"],
  properties: {
    threadId: { type: "string" },
    items: { type: "array", items: STEP_LIST_ITEM },
  },
  additionalProperties: false,
};

const WORKFLOW_DETAIL_ROLE: JSONSchema = {
  type: "object",
  required: ["description"],
  properties: {
    description: { type: "string" },
    goal: { type: "string" },
  },
  additionalProperties: true,
};

export const WORKFLOW_DETAIL_OUTPUT_SCHEMA: JSONSchema = {
  title: "@uwf/output/workflow-detail",
  type: "object",
  required: ["name", "hash", "version", "description", "roles", "graph"],
  properties: {
    name: { type: "string" },
    hash: { type: "string" },
    version: { type: "integer" },
    description: { type: "string" },
    roles: {
      type: "object",
      additionalProperties: WORKFLOW_DETAIL_ROLE,
    },
    graph: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: true,
      },
    },
  },
  additionalProperties: false,
};

const WORKFLOW_LIST_ITEM: JSONSchema = {
  type: "object",
  required: ["name", "hash", "source", "description"],
  properties: {
    name: { type: "string" },
    hash: { type: "string" },
    source: { type: "string" },
    description: { type: "string" },
  },
  additionalProperties: false,
};

export const WORKFLOW_LIST_OUTPUT_SCHEMA: JSONSchema = {
  title: "@uwf/output/workflow-list",
  type: "object",
  required: ["items"],
  properties: {
    items: { type: "array", items: WORKFLOW_LIST_ITEM },
  },
  additionalProperties: false,
};

export const VALIDATE_RESULT_OUTPUT_SCHEMA: JSONSchema = {
  title: "@uwf/output/validate-result",
  type: "object",
  required: ["valid", "errors"],
  properties: {
    valid: { type: "boolean" },
    errors: { type: "array", items: { type: "string" } },
  },
  additionalProperties: false,
};

/** Short names map to schemas — used for variable bindings `@uwf/output/<name>`. */
export const OUTPUT_SCHEMAS = {
  "thread-start": THREAD_START_OUTPUT_SCHEMA,
  "thread-status": THREAD_STATUS_OUTPUT_SCHEMA,
  "thread-list": THREAD_LIST_OUTPUT_SCHEMA,
  "thread-exec": THREAD_EXEC_OUTPUT_SCHEMA,
  "step-detail": STEP_DETAIL_OUTPUT_SCHEMA,
  "step-list": STEP_LIST_OUTPUT_SCHEMA,
  "workflow-detail": WORKFLOW_DETAIL_OUTPUT_SCHEMA,
  "workflow-list": WORKFLOW_LIST_OUTPUT_SCHEMA,
  "validate-result": VALIDATE_RESULT_OUTPUT_SCHEMA,
} as const;

export type OutputSchemaName = keyof typeof OUTPUT_SCHEMAS;

/** Variable name binding for an output schema (`@uwf/output/<name>`). */
export function outputSchemaVarName(name: OutputSchemaName): string {
  return `@uwf/output/${name}`;
}
