import type { AgentFn } from "@uncaged/workflow-runtime";
import { buildAgentPrompt, type SpawnCliError, spawnCli } from "@uncaged/workflow-util-agent";

import type { CursorAgentConfig } from "./types.js";
import { validateCursorAgentConfig } from "./validate-config.js";

export type { CursorAgentConfig } from "./types.js";
export { validateCursorAgentConfig } from "./validate-config.js";

function throwCursorSpawnError(error: SpawnCliError): never {
  if (error.kind === "non_zero_exit") {
    throw new Error(
      `cursor-agent: exitCode=${error.exitCode} stdout=${error.stdout} stderr=${error.stderr}`,
    );
  }
  if (error.kind === "timeout") {
    throw new Error("cursor-agent: timeout");
  }
  if (error.kind === "spawn_failed") {
    throw new Error(`cursor-agent: ${error.message}`);
  }
  throw new Error("cursor-agent: unknown spawn error");
}

function resolveCursorModel(model: string | null): string {
  return model === null ? "auto" : model;
}

/** Runs `cursor-agent` with workspace from {@link CursorAgentConfig.extract} and prompt from context. */
export function createCursorAgent(config: CursorAgentConfig): AgentFn {
  const validated = validateCursorAgentConfig(config);
  if (!validated.ok) {
    throw new Error(validated.error);
  }

  const modelFlag = resolveCursorModel(config.model);
  const timeoutMs = config.timeout > 0 ? config.timeout : null;

  return async (ctx) => {
    const workspace = config.workspace;
    const fullPrompt = await buildAgentPrompt(ctx);
    const args = [
      "-p",
      fullPrompt,
      "--model",
      modelFlag,
      "--workspace",
      workspace,
      "--output-format",
      "text",
      "--trust",
      "--force",
    ];
    const run = await spawnCli("cursor-agent", args, {
      cwd: workspace,
      timeoutMs,
    });
    if (!run.ok) {
      throwCursorSpawnError(run.error);
    }
    return run.value;
  };
}
