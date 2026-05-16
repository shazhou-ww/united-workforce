import type { AdapterFn, AgentFn, WorkflowRuntime } from "@uncaged/workflow-runtime";
import { createLogger, type LogFn } from "@uncaged/workflow-util";
import {
  buildThreadInput,
  createAgentAdapter,
  type SpawnCliError,
  spawnCli,
} from "@uncaged/workflow-util-agent";

import { extractWorkspacePath } from "./extract-workspace.js";
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

type CursorAgentOpt = { prompt: string; workspace: string };

function createCursorAgentFn(
  config: CursorAgentConfig,
  modelFlag: string,
  timeoutMs: number | null,
  logger: LogFn,
): AgentFn<CursorAgentOpt> {
  return async (ctx, { prompt, workspace }) => {
    logger("R5HN3YKQ", `cursor-agent workspace: ${workspace}`);
    const threadInput = await buildThreadInput(ctx);
    const fullPrompt = `${prompt}\n\n${threadInput}`;
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
    const run = await spawnCli(config.command, args, {
      cwd: workspace,
      timeoutMs,
    });
    if (!run.ok) {
      throwCursorSpawnError(run.error);
    }
    return run.value;
  };
}

/** Runs `cursor-agent` with workspace from config or extracted from thread context via runtime.extract. */
export function createCursorAgent(config: CursorAgentConfig): AdapterFn {
  const modelFlag = resolveCursorModel(config.model);
  const timeoutMs = config.timeout > 0 ? config.timeout : null;
  const logger = createLogger({ sink: { kind: "stderr" } });

  return createAgentAdapter(
    createCursorAgentFn(config, modelFlag, timeoutMs, logger),
    async (ctx, prompt, runtime: WorkflowRuntime) => {
      const validated = validateCursorAgentConfig(config);
      if (!validated.ok) {
        throw new Error(validated.error);
      }

      const workspace =
        config.workspace !== null
          ? config.workspace
          : await extractWorkspacePath(ctx, runtime, logger);
      if (workspace === null) {
        throw new Error(
          "cursor-agent: failed to extract workspace path from context. Ensure the task prompt or previous steps include a project path.",
        );
      }
      return { prompt, workspace };
    },
  );
}
