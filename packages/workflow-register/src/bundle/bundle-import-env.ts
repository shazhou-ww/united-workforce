import { pathToFileURL } from "node:url";

/**
 * Dynamic-import a workflow bundle path.
 */
export async function importWorkflowBundleModule(bundlePath: string): Promise<unknown> {
  return import(pathToFileURL(bundlePath).href);
}
