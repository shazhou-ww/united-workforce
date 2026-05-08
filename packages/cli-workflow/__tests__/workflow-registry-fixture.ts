import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Minimal valid global config so {@link executeThread} can resolve the extract scene (CLI integration tests). */
export const TEST_WORKFLOW_REGISTRY_YAML = `config:
  maxDepth: 3
  providers:
    stub:
      baseUrl: http://127.0.0.1:9
      apiKey: test
  models:
    default: stub/m
workflows: {}
`;

export async function ensureTestWorkflowRegistryConfig(storageRoot: string): Promise<void> {
  await writeFile(join(storageRoot, "workflow.yaml"), TEST_WORKFLOW_REGISTRY_YAML, "utf8");
}
