import type { Result } from "@uncaged/workflow-protocol";
import { type GcResult, garbageCollectCas } from "@uncaged/workflow-execute";

export async function cmdGc(storageRoot: string): Promise<Result<GcResult, string>> {
  return garbageCollectCas(storageRoot);
}
