import { pathToFileURL } from "node:url";

/**
 * Dynamic-import a workflow bundle path (see {@link extractBundleExports} — symlink must exist first).
 */
export async function importWorkflowBundleModule(bundlePath: string): Promise<unknown> {
  return import(pathToFileURL(bundlePath).href);
}
