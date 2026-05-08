import { stringify } from "yaml";

import type { WorkflowDescriptor } from "./types.js";

/** Serialize a validated workflow descriptor to YAML for storage next to the bundle. */
export function stringifyWorkflowDescriptor(descriptor: WorkflowDescriptor): string {
  return stringify(descriptor, { indent: 2, defaultStringType: "QUOTE_DOUBLE" });
}
