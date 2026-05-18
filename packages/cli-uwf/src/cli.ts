#!/usr/bin/env bun

import { Command } from "commander";

import {
  cmdThreadKill,
  cmdThreadList,
  cmdThreadShow,
  cmdThreadStart,
  cmdThreadStep,
} from "./commands/thread.js";
import { cmdWorkflowList, cmdWorkflowPut, cmdWorkflowShow } from "./commands/workflow.js";
import { cmdSetup, cmdSetupInteractive } from "./commands/setup.js";
import { resolveStorageRoot } from "./store.js";

function writeJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data)}\n`);
}

function runAction(action: () => Promise<void>): void {
  action().catch((e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}

const program = new Command();

program.name("uwf").description("Stateless workflow CLI");

const workflow = program.command("workflow").description("Workflow registry and CAS");

workflow
  .command("put")
  .description("Register a workflow from YAML")
  .argument("<file>", "Workflow YAML file")
  .action((file: string) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const result = await cmdWorkflowPut(storageRoot, file);
      writeJson(result);
    });
  });

workflow
  .command("show")
  .description("Show a workflow by name or CAS hash")
  .argument("<id>", "Workflow name or hash")
  .action((id: string) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const result = await cmdWorkflowShow(storageRoot, id);
      writeJson(result);
    });
  });

workflow
  .command("list")
  .description("List registered workflows")
  .action(() => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const result = await cmdWorkflowList(storageRoot);
      writeJson(result);
    });
  });

const thread = program.command("thread").description("Thread lifecycle and execution");

thread
  .command("start")
  .description("Create a thread without executing")
  .argument("<workflow>", "Workflow name or hash")
  .requiredOption("-p, --prompt <text>", "User prompt")
  .action((workflow: string, opts: { prompt: string }) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const result = await cmdThreadStart(storageRoot, workflow, opts.prompt);
      writeJson(result);
    });
  });

thread
  .command("step")
  .description("Execute one step")
  .argument("<thread-id>", "Thread ULID")
  .option("--agent <cmd>", "Override agent command")
  .action((threadId: string, opts: { agent: string | undefined }) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const agentOverride = opts.agent ?? null;
      const result = await cmdThreadStep(storageRoot, threadId, agentOverride);
      writeJson(result);
    });
  });

thread
  .command("show")
  .description("Show thread head pointer")
  .argument("<thread-id>", "Thread ULID")
  .action((threadId: string) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const result = await cmdThreadShow(storageRoot, threadId);
      writeJson(result);
    });
  });

thread
  .command("list")
  .description("List active threads")
  .option("--all", "Include archived threads")
  .action((opts: { all: boolean }) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const result = await cmdThreadList(storageRoot, opts.all);
      writeJson(result);
    });
  });

thread
  .command("kill")
  .description("Terminate and archive a thread")
  .argument("<thread-id>", "Thread ULID")
  .action((threadId: string) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const result = await cmdThreadKill(storageRoot, threadId);
      writeJson(result);
    });
  });

program
  .command("setup")
  .description("Configure provider, model, and agent")
  .option("--provider <name>", "Provider name")
  .option("--base-url <url>", "OpenAI-compatible API base URL")
  .option("--api-key <key>", "API key")
  .option("--model <name>", "Default model name")
  .option("--agent <name>", "Default agent alias")
  .action((opts: {
    provider?: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    agent?: string;
  }) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      if (opts.provider && opts.baseUrl && opts.apiKey && opts.model) {
        const result = await cmdSetup({
          provider: opts.provider,
          baseUrl: opts.baseUrl,
          apiKey: opts.apiKey,
          model: opts.model,
          agent: opts.agent,
          storageRoot,
        });
        writeJson(result);
      } else if (!opts.provider && !opts.baseUrl && !opts.apiKey && !opts.model) {
        await cmdSetupInteractive(storageRoot);
      } else {
        throw new Error(
          "Non-interactive setup requires all of: --provider, --base-url, --api-key, --model",
        );
      }
    });
  });

program.parseAsync(process.argv).catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
