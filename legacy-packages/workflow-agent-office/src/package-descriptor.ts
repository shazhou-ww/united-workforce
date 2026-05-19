import type { PackageDescriptor } from "@uncaged/workflow-runtime";

export const packageDescriptor: PackageDescriptor = {
  name: "@uncaged/workflow-agent-office",
  version: "0.1.0",
  capabilities: ["office-agent-cli", "docx-generate", "docx-edit"],
  configSchema: {
    type: "object",
    required: ["outputDir"],
    properties: {
      outputDir: {
        type: "string",
        description: "Root directory for workflow outputs; subdirs are created per threadId.",
      },
      command: {
        anyOf: [{ type: "string" }, { type: "null" }],
        description: "Path to office-agent CLI binary; null uses PATH.",
      },
      timeout: {
        anyOf: [{ type: "number" }, { type: "null" }],
        description: "Timeout in milliseconds; null means no limit.",
      },
    },
    additionalProperties: false,
  },
};
