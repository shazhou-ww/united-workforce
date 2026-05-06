import { pathToFileURL } from "node:url";

import { err, ok, type Result } from "./result.js";
import type { WorkflowFn } from "./types.js";
import type { WorkflowDescriptor } from "./workflow-descriptor.js";
import { validateWorkflowDescriptor } from "./workflow-descriptor.js";

export type ExtractedBundleExports = {
  run: WorkflowFn;
  descriptor: WorkflowDescriptor;
};

/** Load a workflow `.esm.js` bundle and read its named exports (`run`, `descriptor`). */
export async function extractBundleExports(
  bundlePath: string,
): Promise<Result<ExtractedBundleExports, string>> {
  let modUnknown: unknown;
  try {
    // Dynamic import required: user bundle path resolved at runtime
    modUnknown = await import(pathToFileURL(bundlePath).href);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`failed to import bundle: ${message}`);
  }

  const modRec = modUnknown as Record<string, unknown>;
  const defaultExport = modRec.default;
  if (defaultExport !== undefined) {
    return err("workflow bundle must not use default export; export const run instead");
  }

  const run = modRec.run;
  if (typeof run !== "function") {
    return err("workflow bundle must export run as a function");
  }

  const validated = validateWorkflowDescriptor(modRec.descriptor);
  if (!validated.ok) {
    return err(validated.error);
  }

  return ok({ run: run as WorkflowFn, descriptor: validated.value });
}
