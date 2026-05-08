import { resolveModel } from "./config/index.js";
import type { WorkflowConfig } from "./registry/index.js";
import { readWorkflowRegistry } from "./registry/index.js";
import type { LlmProvider } from "./types.js";
import { err, getDefaultWorkflowStorageRoot, ok, type Result } from "./util/index.js";

const DEFAULT_WORKFLOW_AS_AGENT_MAX_DEPTH = 3;

export function getWorkflowAsAgentMaxDepth(config: WorkflowConfig | null): number {
  if (config === null) {
    return DEFAULT_WORKFLOW_AS_AGENT_MAX_DEPTH;
  }
  return config.maxDepth;
}

/** Loads the LLM provider for scene `extract` from workflow.yaml (`config.models` + `config.providers`; apiKey resolved at registry parse time). */
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
  const resolved = resolveModel(cfg, "extract");
  if (!resolved.ok) {
    return resolved;
  }
  const ex = resolved.value;
  return ok({
    baseUrl: ex.baseUrl,
    apiKey: ex.apiKey,
    model: ex.model,
  });
}
