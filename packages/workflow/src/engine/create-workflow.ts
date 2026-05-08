/**
 * Re-export of {@link createWorkflow} from `@uncaged/workflow-runtime`.
 *
 * The runtime's `createWorkflow` already binds role definitions + agents to a workflow loop
 * and delegates structured meta extraction to `WorkflowFnOptions.extract`, which the engine
 * supplies (resolved from the `extract` scene in workflow.yaml).
 */
export { createWorkflow } from "@uncaged/workflow-runtime";
