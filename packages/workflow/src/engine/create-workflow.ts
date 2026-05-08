import type {
  AgentBinding,
  RoleMeta,
  WorkflowDefinition,
  WorkflowFn,
} from "@uncaged/workflow-runtime";
import { createWorkflow as createWorkflowRuntime } from "@uncaged/workflow-runtime";

import { resolveRoleMeta } from "./resolve-role-meta.js";

/**
 * Binds pure role definitions + moderator to runtime agents.
 * Assign with `export const run = createWorkflow(def, binding)`.
 * The engine supplies {@link WorkflowFnOptions.extract} and {@link WorkflowFnOptions.llmProvider} from workflow.yaml.
 */
export function createWorkflow<M extends RoleMeta>(
  def: Pick<WorkflowDefinition<M>, "roles" | "moderator">,
  binding: AgentBinding,
): WorkflowFn {
  return createWorkflowRuntime(def, binding, resolveRoleMeta);
}
