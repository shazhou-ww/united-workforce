import { err, ok, type Result, type WorkflowConfig } from "@uncaged/workflow-protocol";
import {
  readWorkflowRegistry,
  splitProviderModelRef,
  workflowRegistryPath,
  writeWorkflowRegistry,
} from "@uncaged/workflow-register";
import { createLogger } from "@uncaged/workflow-util";

import { printCliLine } from "../../cli-output.js";
import { cmdInitWorkspace } from "../init/index.js";
import type { CmdSetupSuccess, SetupCliArgs } from "./types.js";

const setupLog = createLogger({ sink: { kind: "stderr" } });



function mergeWorkflowConfig(
  prev: WorkflowConfig | null,
  input: SetupCliArgs,
): Result<WorkflowConfig, string> {
  const modelSplit = splitProviderModelRef(input.defaultModel);
  if (!modelSplit.ok) {
    return err(modelSplit.error);
  }
  if (modelSplit.value.providerName !== input.provider) {
    return err(
      `default model provider "${modelSplit.value.providerName}" must match --provider "${input.provider}"`,
    );
  }

  const maxDepth = prev === null ? 3 : prev.maxDepth;
  const supervisorInterval = prev === null ? 3 : prev.supervisorInterval;
  const providers = {
    ...(prev === null ? {} : prev.providers),
    [input.provider]: { baseUrl: input.baseUrl, apiKey: input.apiKey },
  };
  const models = { ...(prev === null ? {} : prev.models), default: input.defaultModel };

  return ok({
    maxDepth,
    supervisorInterval,
    providers,
    models,
  });
}

export async function cmdSetup(
  storageRoot: string,
  input: SetupCliArgs,
): Promise<Result<CmdSetupSuccess, string>> {
  const readResult = await readWorkflowRegistry(storageRoot);
  if (!readResult.ok) {
    setupLog("W8JH4Q2K", `read workflow registry failed: ${readResult.error.message}`);
    return err(readResult.error.message);
  }

  const current = readResult.value;
  const merged = mergeWorkflowConfig(current.config, input);
  if (!merged.ok) {
    return merged;
  }
  const nextConfig = merged.value;
  const nextRegistry = {
    config: nextConfig,
    workflows: current.workflows,
  };

  const written = await writeWorkflowRegistry(storageRoot, nextRegistry);
  if (!written.ok) {
    setupLog("M2NB5VX9", `write workflow registry failed: ${written.error.message}`);
    return err(written.error.message);
  }

  const registryPath = workflowRegistryPath(storageRoot);

  let initWorkspaceRootPath: string | null = null;
  if (input.initWorkspaceName !== null) {
    const initResult = await cmdInitWorkspace(process.cwd(), input.initWorkspaceName);
    if (!initResult.ok) {
      setupLog("T7QC4HWP", `init workspace failed: ${initResult.error}`);
      return err(initResult.error);
    }
    initWorkspaceRootPath = initResult.value.rootPath;
  }

  return ok({
    registryPath,
    provider: input.provider,
    defaultModel: input.defaultModel,
    maxDepth: nextConfig.maxDepth,
    supervisorInterval: nextConfig.supervisorInterval,
    initWorkspaceRootPath,
  });
}

export function printSetupSummary(result: CmdSetupSuccess): void {
  printCliLine(`wrote registry: ${result.registryPath}`);
  printCliLine(`provider "${result.provider}" (baseUrl + apiKey updated)`);
  printCliLine(`config.models.default = "${result.defaultModel}"`);
  printCliLine(`maxDepth=${result.maxDepth}, supervisorInterval=${result.supervisorInterval}`);
  if (result.initWorkspaceRootPath !== null) {
    printCliLine(`initialized workflow workspace at ${result.initWorkspaceRootPath}`);
  }
}
