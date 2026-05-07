import { type GcResult, garbageCollectCas, type Result } from "@uncaged/workflow";

export async function cmdGc(storageRoot: string): Promise<Result<GcResult, string>> {
  return garbageCollectCas(storageRoot);
}
