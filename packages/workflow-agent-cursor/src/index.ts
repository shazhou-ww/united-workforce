import type { WorkflowRuntime } from "@uncaged/workflow-runtime";
import { createLogger } from "@uncaged/workflow-util";
import {
  buildThreadInput,
  createTextAdapter,
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

/** Runs `cursor-agent` with workspace extracted from thread context via runtime.extract. */
export function createCursorAgent(config: CursorAgentConfig) {
  const modelFlag = resolveCursorModel(config.model);
  const timeoutMs = config.timeout > 0 ? config.timeout : null;
  const logger = createLogger({ sink: { kind: "stderr" } });

  return createTextAdapter(async (ctx, prompt, runtime: WorkflowRuntime) => {
    const validated = validateCursorAgentConfig(config);
    if (!validated.ok) {
      throw new Error(validated.error);
    }

    const workspace = await extractWorkspacePath(ctx, runtime, logger);
    if (workspace === null) {
      throw new Error(
        "cursor-agent: failed to extract workspace path from context. Ensure the task prompt or previous steps include a project path.",
      );
    }

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
  });
}
