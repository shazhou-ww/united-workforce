import type {
  ExtractContext,
  RoleDefinition,
  RoleMeta,
  WorkflowFnOptions,
} from "@uncaged/workflow-runtime";

import { buildExtractUserContent } from "../extract/extract-fn.js";
import { reactExtract } from "../extract/react-extract.js";

export async function resolveRoleMeta<M extends RoleMeta>(
  roleDef: RoleDefinition<Record<string, unknown>>,
  extractCtx: ExtractContext<M>,
  options: WorkflowFnOptions,
): Promise<Record<string, unknown>> {
  if (roleDef.extractMode === "react") {
    if (options.llmProvider === null) {
      throw new Error(
        'createWorkflow: WorkflowFnOptions.llmProvider is required when a role uses extractMode "react"',
      );
    }
    const text = await buildExtractUserContent(
      extractCtx as unknown as ExtractContext,
      roleDef.extractPrompt,
    );
    const reactResult = await reactExtract({
      text,
      schema: roleDef.schema,
      provider: options.llmProvider,
      cas: options.cas,
    });
    if (!reactResult.ok) {
      throw new Error(`react extract failed: ${reactResult.error}`);
    }
    return reactResult.value as Record<string, unknown>;
  }
  return (await options.extract(
    roleDef.schema,
    roleDef.extractPrompt,
    extractCtx as unknown as ExtractContext,
  )) as Record<string, unknown>;
}
