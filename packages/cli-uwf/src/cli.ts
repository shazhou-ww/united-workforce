#!/usr/bin/env bun

import { Command } from "commander";

import { cmdThreadPlaceholder } from "./commands/thread.js";
import { cmdWorkflowList, cmdWorkflowPut, cmdWorkflowShow } from "./commands/workflow.js";
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

const thread = program.command("thread").description("Thread execution (Phase 4)");

thread
  .command("start")
  .description("Create a thread without executing")
  .argument("<workflow>", "Workflow name or hash")
  .requiredOption("-p, --prompt <text>", "User prompt")
  .action(() => {
    cmdThreadPlaceholder("start");
  });

thread
  .command("step")
  .description("Execute one step")
  .argument("<thread-id>", "Thread ULID")
  .option("--agent <cmd>", "Override agent command")
  .action(() => {
    cmdThreadPlaceholder("step");
  });

thread
  .command("show")
  .description("Show thread head pointer")
  .argument("<thread-id>", "Thread ULID")
  .action(() => {
    cmdThreadPlaceholder("show");
  });

thread
  .command("list")
  .description("List active threads")
  .option("--all", "Include archived threads")
  .action(() => {
    cmdThreadPlaceholder("list");
  });

thread
  .command("kill")
  .description("Terminate and archive a thread")
  .argument("<thread-id>", "Thread ULID")
  .action(() => {
    cmdThreadPlaceholder("kill");
  });

program.parseAsync(process.argv).catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
