import { err, ok, type Result } from "../util/index.js";

/** Parses `providerName/modelName` references used in {@link WorkflowConfig.models}. */
export function splitProviderModelRef(
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
