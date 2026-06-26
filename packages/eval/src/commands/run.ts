import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createLogger } from "@united-workforce/util";
import type { Command } from "commander";
import type { RunResult } from "../runner/index.js";
import { collect, execute, getEngineVersion, prepare } from "../runner/index.js";
import type { EvalRunConfig } from "../storage/index.js";
import { createEvalStore } from "../storage/index.js";

const log = createLogger({ sink: { kind: "stderr" } });
const LOG_CLEANUP = "EVC1NP7Q";

type RunCliOptions = {
  agent: string;
  model: string | undefined;
  count: string;
  keepWorkdir: boolean;
};

async function runOnce(
  taskDir: string,
  agent: string,
  model: string,
  engineVersion: string,
  keepWorkdir: boolean,
): Promise<RunResult> {
  const prepared = await prepare(taskDir);
  const { manifest, workDir } = prepared;

  try {
    const { threadId } = await execute({
      workDir,
      workflow: manifest.workflow,
      prompt: manifest.prompt,
      agent,
      maxSteps: manifest.limits.maxSteps,
    });

    const evalStore = await createEvalStore();
    const config: EvalRunConfig = { agent, model, engineVersion };
    const collected = await collect({
      evalStore,
      taskDir: prepared.taskDir,
      workDir,
      threadId,
      manifest,
      config,
    });

    return {
      runHash: collected.runHash,
      overall: collected.overall,
      task: manifest.name,
      judges: collected.judges,
    };
  } finally {
    if (keepWorkdir) {
      log(LOG_CLEANUP, `keeping workDir: ${workDir}`);
    } else {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

export function registerRunCommand(program: Command): void {
  program
    .command("run <task>")
    .description("Run eval on a task directory or tarball")
    .option("--agent <name>", "agent adapter to use", "uwf-builtin")
    .option("--model <model>", "model override")
    .option("--count <n>", "number of eval runs", "1")
    .option("--keep-workdir", "keep the temporary workDir after run (for debugging)", false)
    .action(async (task: string, opts: RunCliOptions) => {
      const taskDir = resolve(task);
      const agent = opts.agent;
      const model = opts.model ?? "";
      const count = Number.parseInt(opts.count, 10);
      if (!Number.isInteger(count) || count < 1) {
        process.stderr.write("--count must be a positive integer\n");
        process.exitCode = 1;
        return;
      }

      const engineVersion = getEngineVersion();

      try {
        const results: RunResult[] = [];
        for (let i = 0; i < count; i++) {
          results.push(await runOnce(taskDir, agent, model, engineVersion, opts.keepWorkdir));
        }
        const output = count === 1 ? results[0] : results;
        process.stdout.write(`${JSON.stringify(output)}\n`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        process.stderr.write(`${message}\n`);
        process.exitCode = 1;
      }
    });
}
