import { type GcResult, garbageCollectCas } from "@uncaged/workflow-execute";
import type { Result } from "@uncaged/workflow-protocol";

export async function cmdGc(storageRoot: string): Promise<Result<GcResult, string>> {
  return garbageCollectCas(storageRoot);
}
