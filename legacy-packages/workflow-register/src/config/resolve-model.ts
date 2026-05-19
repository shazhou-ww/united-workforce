import type { WorkflowConfig } from "@uncaged/workflow-protocol";
import { err, ok, type Result } from "@uncaged/workflow-util";
import { splitProviderModelRef } from "./split-provider-model-ref.js";
import type { ResolvedModel } from "./types.js";

/** Resolves scene → provider endpoint + model using {@link WorkflowConfig.providers} and {@link WorkflowConfig.models}. */
export function resolveModel(config: WorkflowConfig, scene: string): Result<ResolvedModel, string> {
  const models = config.models;
  let ref = models[scene] ?? null;
  if (ref === null) {
    ref = models.default ?? null;
  }
  if (ref === null) {
    return err(`no model mapping for scene "${scene}" and no models.default fallback`);
  }
  const split = splitProviderModelRef(ref);
  if (!split.ok) {
    return split;
  }
  const { providerName, modelName } = split.value;
  const provider = config.providers[providerName] ?? null;
  if (provider === null) {
    return err(`unknown provider "${providerName}" referenced by scene "${scene}"`);
  }
  return ok({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: modelName,
  });
}
