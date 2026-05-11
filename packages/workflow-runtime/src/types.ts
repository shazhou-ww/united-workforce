// Re-export all types from the protocol package.
// This file exists for backward compatibility — downstream code that
// imports from "@uncaged/workflow-runtime" continues to work.

export type {
  AdvanceOutcome,
  AgentBinding,
  AgentContext,
  AgentFn,
  CasStore,
  ExtractFn,
  ExtractResult,
  FALLBACK,
  LlmProvider,
  Moderator,
  ModeratorCondition,
  ModeratorContext,
  ModeratorTable,
  ModeratorTransition,
  ProviderConfig,
  ResolvedModel,
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

export { END, START, tableToModerator } from "@uncaged/workflow-protocol";
