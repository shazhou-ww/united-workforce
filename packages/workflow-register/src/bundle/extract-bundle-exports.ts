import type { WorkflowFn } from "@uncaged/workflow-protocol";
import { err, ok, type Result } from "@uncaged/workflow-util";
import { importWorkflowBundleModule } from "./bundle-import-env.js";
import { ensureUncagedWorkflowSymlink } from "./ensure-uncaged-workflow-symlink.js";
import type { ExtractBundleExportsOptions, ExtractedBundleExports } from "./types.js";
import { validateWorkflowDescriptor } from "./workflow-descriptor.js";

/** Load a workflow `.esm.js` bundle and read its named exports (`run`, `descriptor`). */
export async function extractBundleExports(
  bundlePath: string,
  options: ExtractBundleExportsOptions = { storageRoot: null },
): Promise<Result<ExtractedBundleExports, string>> {
  let modUnknown: unknown;
  try {
    if (options.storageRoot !== null) {
      await ensureUncagedWorkflowSymlink(options.storageRoot);
    }
    // Dynamic import required: user bundle path resolved at runtime
    modUnknown = await importWorkflowBundleModule(bundlePath);
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
