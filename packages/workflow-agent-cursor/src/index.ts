import type { AdapterFn } from "@uncaged/workflow-runtime";
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

/** Runs `cursor-agent` with workspace from config or extracted from context via LLM. */
export function createCursorAgent(config: CursorAgentConfig): AdapterFn {
  const modelFlag = resolveCursorModel(config.model);
  const timeoutMs = config.timeout > 0 ? config.timeout : null;
  const logger = createLogger({ sink: { kind: "stderr" } });

  return createTextAdapter(async (ctx, prompt) => {
    const validated = validateCursorAgentConfig(config);
    if (!validated.ok) {
      throw new Error(validated.error);
    }

    let workspace: string;

    if (config.workspace !== null) {
      workspace = config.workspace;
    } else {
      if (config.llmProvider === null) {
        throw new Error("cursor-agent: llmProvider is required when workspace is null");
      }
      const agentCtx = { ...ctx, currentRole: { name: "cursor", systemPrompt: prompt } };
      const extracted = await extractWorkspacePath(agentCtx, config.llmProvider, logger);
      if (extracted === null) {
        throw new Error(
          "cursor-agent: failed to extract workspace path from context. Provide an explicit workspace or ensure previous steps include a repoPath.",
        );
      }
      workspace = extracted;
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
