import type { WorkflowConfig } from "../registry/index.js";
import { err, ok, type Result } from "../util/index.js";
import type { ResolvedModel } from "./types.js";

function splitProviderModelRef(
  ref: string,
): Result<{ providerName: string; modelName: string }, string> {
  const idx = ref.indexOf("/");
  if (idx <= 0 || idx === ref.length - 1) {
    return err(`invalid model reference "${ref}": expected providerName/modelName`);
  }
  const providerName = ref.slice(0, idx);
  const modelName = ref.slice(idx + 1);
  if (providerName === "" || modelName === "") {
    return err(`invalid model reference "${ref}": expected providerName/modelName`);
  }
  return ok({ providerName, modelName });
}

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
