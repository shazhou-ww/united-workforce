// Re-export all types from the protocol package.
// This file exists for backward compatibility — downstream code that
// imports from "@uncaged/workflow-runtime" continues to work.

export type {
  AdvanceOutcome,
  AgentBinding,
  AgentContext,
  AgentFn,
  CasStore,
  ExtractContext,
  ExtractFn,
  ExtractResult,
  LlmProvider,
  Moderator,
  ModeratorContext,
  Result,
  RoleDefinition,
  RoleMeta,
  RoleOutput,
  RoleStep,
  StartStep,
  ThreadContext,
  WorkflowCompletion,
  WorkflowDefinition,
  WorkflowDescriptor,
  WorkflowFn,
  WorkflowResult,
  WorkflowRoleDescriptor,
  WorkflowRoleSchema,
  WorkflowRuntime,
} from "@uncaged/workflow-protocol";

export { END, START } from "@uncaged/workflow-protocol";
