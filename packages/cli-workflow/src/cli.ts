#!/usr/bin/env bun

import type { ThreadId } from "@uncaged/workflow-protocol";
import { Command } from "commander";
import { stringify as yamlStringify } from "yaml";
import {
  cmdCasGet,
  cmdCasHas,
  cmdCasPut,
  cmdCasRefs,
  cmdCasReindex,
  cmdCasSchemaGet,
  cmdCasSchemaList,
  cmdCasWalk,
} from "./commands/cas.js";
import { cmdSetup, cmdSetupInteractive } from "./commands/setup.js";
import { cmdSkillCli } from "./commands/skill.js";
import {
  cmdThreadFork,
  cmdThreadKill,
  cmdThreadList,
  cmdThreadRead,
  cmdThreadShow,
  cmdThreadStart,
  cmdThreadStep,
  cmdThreadStepDetails,
  cmdThreadSteps,
  THREAD_READ_DEFAULT_QUOTA,
} from "./commands/thread.js";
import { cmdWorkflowList, cmdWorkflowPut, cmdWorkflowShow } from "./commands/workflow.js";
import { formatOutput, type OutputFormat } from "./format.js";
import { resolveStorageRoot } from "./store.js";

function writeOutput(data: unknown): void {
  const fmt = program.opts().format as OutputFormat;
  process.stdout.write(`${formatOutput(data, fmt)}\n`);
}

function runAction(action: () => Promise<void>): void {
  action().catch((e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}

const program = new Command();

// eslint-disable-next-line -- dynamic import for version
const pkg = await import("../package.json", { with: { type: "json" } });
program
  .name("uwf")
  .description("Stateless workflow CLI")
  .version(pkg.default.version, "-V, --version");
program.option("--format <fmt>", "Output format: json or yaml", "json");

const workflow = program.command("workflow").description("Workflow registry and CAS");

workflow
  .command("put")
  .description("Register a workflow from YAML")
  .argument("<file>", "Workflow YAML file")
  .action((file: string) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const result = await cmdWorkflowPut(storageRoot, file);
      writeOutput(result);
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
      writeOutput(result);
    });
  });

workflow
  .command("list")
  .description("List registered workflows")
  .action(() => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const result = await cmdWorkflowList(storageRoot, process.cwd());
      writeOutput(result);
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
      const result = await cmdThreadStart(storageRoot, workflow, opts.prompt, process.cwd());
      writeOutput(result);
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
      writeOutput(result);
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
      writeOutput(result);
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
      writeOutput(result);
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
      writeOutput(result);
    });
  });

thread
  .command("steps")
  .description("List all steps in a thread")
  .argument("<thread-id>", "Thread ULID")
  .action((threadId: string) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const result = await cmdThreadSteps(storageRoot, threadId);
      writeOutput(result);
    });
  });

thread
  .command("read")
  .description("Read thread context as human-readable markdown")
  .argument("<thread-id>", "Thread ULID")
  .option("--quota <chars>", "Max output characters", String(THREAD_READ_DEFAULT_QUOTA))
  .option("--before <step-hash>", "Load steps before this hash (exclusive)")
  .option("--start", "Include start step in output")
  .action(
    (threadId: string, opts: { quota: string; before: string | undefined; start: boolean }) => {
      const storageRoot = resolveStorageRoot();
      runAction(async () => {
        const quota = Number.parseInt(opts.quota, 10);
        if (!Number.isFinite(quota) || quota < 1) {
          process.stderr.write("invalid --quota: must be a positive integer\n");
          process.exit(1);
        }
        const before = opts.before ?? null;
        const markdown = await cmdThreadRead(
          storageRoot,
          threadId as ThreadId,
          quota,
          before,
          opts.start ?? false,
        );
        process.stdout.write(markdown.endsWith("\n") ? markdown : `${markdown}\n`);
      });
    },
  );

thread
  .command("fork")
  .description("Fork a thread from a specific step")
  .argument("<step-hash>", "CAS hash of the StartNode or StepNode to fork from")
  .action((stepHash: string) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const result = await cmdThreadFork(storageRoot, stepHash);
      writeOutput(result);
    });
  });

thread
  .command("step-details")
  .description("Dump the full detail node of a step as YAML")
  .argument("<step-hash>", "CAS hash of the StepNode")
  .action((stepHash: string) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const detail = await cmdThreadStepDetails(storageRoot, stepHash);
      process.stdout.write(yamlStringify(detail));
    });
  });

const skill = program.command("skill").description("Built-in skill references for agents");

skill
  .command("cli")
  .description("Print a markdown reference of all uwf commands")
  .action(() => {
    console.log(cmdSkillCli());
  });

program
  .command("setup")
  .description("Configure provider, model, and agent")
  .option("--provider <name>", "Provider name")
  .option("--base-url <url>", "OpenAI-compatible API base URL")
  .option("--api-key <key>", "API key")
  .option("--model <name>", "Default model name")
  .option("--agent <name>", "Default agent alias")
  .action(
    (opts: {
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
            agent: opts.agent ?? undefined,
            storageRoot,
          });
          writeOutput(result);
        } else if (!opts.provider && !opts.baseUrl && !opts.apiKey && !opts.model) {
          await cmdSetupInteractive(storageRoot);
        } else {
          throw new Error(
            "Non-interactive setup requires all of: --provider, --base-url, --api-key, --model",
          );
        }
      });
    },
  );

const cas = program.command("cas").description("Content-addressable storage operations");

cas
  .command("get")
  .description("Read a CAS node (type + payload; use --timestamp to include timestamp)")
  .argument("<hash>", "CAS hash (13 char)")
  .option("--timestamp", "Include timestamp in output")
  .action((hash: string, opts: { timestamp?: boolean }) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      writeOutput(await cmdCasGet(storageRoot, hash, opts));
    });
  });

cas
  .command("put")
  .description("Store a node, print its hash")
  .argument("<type-hash>", "Type (schema) hash")
  .argument("<data>", "JSON file path or inline JSON string")
  .action((typeHash: string, data: string) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      writeOutput(await cmdCasPut(storageRoot, typeHash, data));
    });
  });

cas
  .command("has")
  .description("Check if a hash exists")
  .argument("<hash>", "CAS hash (13 char)")
  .action((hash: string) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      writeOutput(await cmdCasHas(storageRoot, hash));
    });
  });

cas
  .command("refs")
  .description("List direct CAS references from a node")
  .argument("<hash>", "CAS hash (13 char)")
  .action((hash: string) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      writeOutput(await cmdCasRefs(storageRoot, hash));
    });
  });

cas
  .command("walk")
  .description("Recursive traversal from a node")
  .argument("<hash>", "CAS hash (13 char)")
  .action((hash: string) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      writeOutput(await cmdCasWalk(storageRoot, hash));
    });
  });

cas
  .command("reindex")
  .description("Rebuild type index from all CAS nodes")
  .action(() => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      writeOutput(await cmdCasReindex(storageRoot));
    });
  });

const casSchema = cas.command("schema").description("CAS schema operations");

casSchema
  .command("list")
  .description("List all registered schemas")
  .action(() => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      writeOutput(await cmdCasSchemaList(storageRoot));
    });
  });

casSchema
  .command("get")
  .description("Show a schema by its type hash")
  .argument("<hash>", "Schema type hash")
  .action((hash: string) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      writeOutput(await cmdCasSchemaGet(storageRoot, hash));
    });
  });

program.parseAsync(process.argv).catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
