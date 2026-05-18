import type { PackageDescriptor } from "@uncaged/workflow-runtime";

export const packageDescriptor: PackageDescriptor = {
  name: "@uncaged/workflow-agent-docx-diff",
  version: "0.1.0",
  capabilities: ["docx-diff-cli", "docx-diff-report"],
  configSchema: {
    type: "object",
    properties: {
      command: {
        anyOf: [{ type: "string" }, { type: "null" }],
        description: "Path to docx-diff CLI binary; null uses PATH.",
      },
    },
    additionalProperties: false,
  },
};
