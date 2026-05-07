import { readWorkflowRegistry } from "./registry.js";
import type { WorkflowConfig } from "./registry-types.js";
import { err, ok, type Result } from "./result.js";
import { getDefaultWorkflowStorageRoot } from "./storage-root.js";
import type { LlmProvider } from "./types.js";

const DEFAULT_WORKFLOW_AS_AGENT_MAX_DEPTH = 3;

export function getWorkflowAsAgentMaxDepth(config: WorkflowConfig | null): number {
  if (config === null) {
    return DEFAULT_WORKFLOW_AS_AGENT_MAX_DEPTH;
  }
  return config.maxDepth;
}

/** Loads `config.extract` from workflow.yaml (apiKey already resolved at registry parse time). */
export async function getExtractProvider(
  storageRoot: string | undefined,
): Promise<Result<LlmProvider, string>> {
  const root = storageRoot ?? getDefaultWorkflowStorageRoot();
  const regResult = await readWorkflowRegistry(root);
  if (!regResult.ok) {
    return err(regResult.error.message);
  }
  const cfg = regResult.value.config;
  if (cfg === null) {
    return err("workflow registry has no global config section");
  }
  const ex = cfg.extract;
  return ok({
    baseUrl: ex.baseUrl,
    apiKey: ex.apiKey,
    model: ex.model,
  });
}
