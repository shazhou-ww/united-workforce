import type { AdapterFn } from "@uncaged/workflow-runtime";
import {
  buildThreadInput,
  createTextAdapter,
  type SpawnCliError,
  spawnCli,
} from "@uncaged/workflow-util-agent";

import type { HermesAgentConfig } from "./types.js";
import { validateHermesAgentConfig } from "./validate-config.js";

const HERMES_DEFAULT_MAX_TURNS = 90;

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
export function createHermesAgent(config: HermesAgentConfig): AdapterFn {
  const timeoutMs = config.timeout;

  return createTextAdapter(async (ctx, prompt) => {
    const validated = validateHermesAgentConfig(config);
    if (!validated.ok) {
      throw new Error(validated.error);
    }

    const threadInput = await buildThreadInput(ctx);
    const fullPrompt = `${prompt}\n\n${threadInput}`;
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
    const run = await spawnCli(config.command, args, {
      cwd: null,
      timeoutMs,
    });
    if (!run.ok) {
      throwHermesSpawnError(run.error);
    }
    return run.value;
  });
}
