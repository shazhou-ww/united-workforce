import type { AgentFn } from "@uncaged/workflow";

import { buildAgentPrompt } from "./build-agent-prompt.js";
import { type SpawnCliError, spawnCli } from "./spawn-cli.js";
import type { HermesAgentConfig } from "./types.js";
import { validateHermesAgentConfig } from "./validate-config.js";

const HERMES_DEFAULT_MAX_TURNS = 90;

export { buildAgentPrompt } from "./build-agent-prompt.js";
export type { HermesAgentConfig } from "./types.js";
export { validateHermesAgentConfig } from "./validate-config.js";

function throwHermesSpawnError(error: SpawnCliError): never {
  if (error.kind === "non_zero_exit") {
    throw new Error(
      `hermes: exitCode=${error.exitCode} stdout=${error.stdout} stderr=${error.stderr}`,
    );
  }
  if (error.kind === "timeout") {
    throw new Error("hermes: timeout");
  }
  if (error.kind === "spawn_failed") {
    throw new Error(`hermes: ${error.message}`);
  }
  throw new Error("hermes: unknown spawn error");
}

/** Runs `hermes chat` non-interactively with the Nerve-style argv contract (`-q`, `--yolo`, `--quiet`). */
export function createHermesAgent(config: HermesAgentConfig): AgentFn {
  const validated = validateHermesAgentConfig(config);
  if (!validated.ok) {
    throw new Error(validated.error);
  }

  const timeoutMs = config.timeout;

  return async (ctx, systemPrompt) => {
    const fullPrompt = buildAgentPrompt(ctx, systemPrompt);
    const args = [
      "chat",
      "-q",
      fullPrompt,
      "--yolo",
      "--max-turns",
      String(HERMES_DEFAULT_MAX_TURNS),
      "--quiet",
    ];
    if (config.model !== null) {
      args.push("--model", config.model);
    }
    const run = await spawnCli("hermes", args, {
      cwd: null,
      timeoutMs,
    });
    if (!run.ok) {
      throwHermesSpawnError(run.error);
    }
    return run.value;
  };
}
