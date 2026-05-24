#!/usr/bin/env bun

import type { CasRef, ThreadId } from "@uncaged/workflow-protocol";
import { Command } from "commander";
import {
  cmdCasGet,
  cmdCasHas,
  cmdCasPut,
  cmdCasPutText,
  cmdCasRefs,
  cmdCasReindex,
  cmdCasSchemaGet,
  cmdCasSchemaList,
  cmdCasWalk,
} from "./commands/cas.js";
import { cmdLogClean, cmdLogList, cmdLogShow } from "./commands/log.js";
import { cmdSetup, cmdSetupInteractive } from "./commands/setup.js";
import { cmdSkillCli } from "./commands/skill.js";
import { cmdStepFork, cmdStepList, cmdStepRead, cmdStepShow } from "./commands/step.js";
import {
  cmdThreadCancel,
  cmdThreadExec,
  cmdThreadList,
  cmdThreadRead,
  cmdThreadShow,
  cmdThreadStart,
  cmdThreadStop,
  THREAD_READ_DEFAULT_QUOTA,
  type ThreadStatus,
} from "./commands/thread.js";
import { cmdWorkflowAdd, cmdWorkflowList, cmdWorkflowShow } from "./commands/workflow.js";
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
  .description(
    "Stateless workflow CLI\n\n" +
      "Four-layer architecture:\n" +
      "  workflow → thread → step → turn\n" +
      "  模板定义   执行实例   单步结果   agent内部交互",
  )
  .version(pkg.default.version, "-V, --version");
program.option("--format <fmt>", "Output format: json or yaml", "json");

const workflow = program
  .command("workflow")
  .description("Workflow definitions (layer 1: templates)");

workflow
  .command("add")
  .description("Register a workflow from YAML")
  .argument("<file>", "Workflow YAML file")
  .action((file: string) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const result = await cmdWorkflowAdd(storageRoot, file);
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

const thread = program.command("thread").description("Thread execution (layer 2: instances)");

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
  .command("exec")
  .description("Execute one or more steps")
  .argument("<thread-id>", "Thread ULID")
  .option("--agent <cmd>", "Override agent command")
  .option("-c, --count <number>", "Number of steps to run (default: 1)")
  .option("--background", "Run in background and return immediately")
  .option("--_background-worker", "Internal flag for background worker process", false)
  .action(
    (
      threadId: string,
      opts: {
        agent: string | undefined;
        count: string | undefined;
        background: boolean;
        _backgroundWorker: boolean;
      },
    ) => {
      const storageRoot = resolveStorageRoot();
      runAction(async () => {
        const agentOverride = opts.agent ?? null;
        const count = opts.count !== undefined ? Number(opts.count) : 1;
        const background = opts.background ?? false;
        const backgroundWorker = opts._backgroundWorker ?? false;

        const results = await cmdThreadExec(
          storageRoot,
          threadId,
          agentOverride,
          count,
          background,
          backgroundWorker,
        );
        if (results.length === 1) {
          writeOutput(results[0]);
        } else {
          writeOutput(results);
        }
      });
    },
  );

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
  .description("List threads")
  .option("--status <status>", "Filter by status: idle, running, or completed")
  .action((opts: { status: string | undefined }) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const validStatuses: ThreadStatus[] = ["idle", "running", "completed"];
      let statusFilter: ThreadStatus | null = null;

      if (opts.status !== undefined) {
        if (!validStatuses.includes(opts.status as ThreadStatus)) {
          process.stderr.write(
            `Invalid status: ${opts.status}. Must be one of: idle, running, completed\n`,
          );
          process.exit(1);
        }
        statusFilter = opts.status as ThreadStatus;
      }

      const result = await cmdThreadList(storageRoot, statusFilter);
      writeOutput(result);
    });
  });

thread
  .command("stop")
  .description("Stop background execution of a thread (keep thread active)")
  .argument("<thread-id>", "Thread ULID")
  .action((threadId: string) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const result = await cmdThreadStop(storageRoot, threadId);
      writeOutput(result);
    });
  });

thread
  .command("cancel")
  .description("Cancel a thread (stop execution and move to history)")
  .argument("<thread-id>", "Thread ULID")
  .action((threadId: string) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const result = await cmdThreadCancel(storageRoot, threadId);
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

const step = program.command("step").description("Step results (layer 3: single cycle)");

step
  .command("list")
  .description("List all steps in a thread")
  .argument("<thread-id>", "Thread ULID")
  .action((threadId: string) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const result = await cmdStepList(storageRoot, threadId);
      writeOutput(result);
    });
  });

step
  .command("show")
  .description("Show details of a specific step")
  .argument("<step-hash>", "CAS hash of the StepNode")
  .action((stepHash: string) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const detail = await cmdStepShow(storageRoot, stepHash as CasRef);
      writeOutput(detail);
    });
  });

step
  .command("read")
  .description("Read a step's agent output as markdown")
  .argument("<step-hash>", "CAS hash of the StepNode")
  .option("--before <n>", "Show only first N turns")
  .action((stepHash: string, opts: { before: string | undefined }) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const before = opts.before !== undefined ? Number.parseInt(opts.before, 10) : null;
      const markdown = await cmdStepRead(storageRoot, stepHash as CasRef, before);
      process.stdout.write(markdown.endsWith("\n") ? markdown : `${markdown}\n`);
    });
  });

step
  .command("fork")
  .description("Fork a thread from a specific step")
  .argument("<step-hash>", "CAS hash of the StartNode or StepNode to fork from")
  .action((stepHash: string) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const result = await cmdStepFork(storageRoot, stepHash as CasRef);
      writeOutput(result);
    });
  });

// ── Deprecation Handlers ──────────────────────────────────────────────────────
// These commands have been removed. Show helpful error messages.

workflow
  .command("put")
  .description("[DEPRECATED] Use 'workflow add' instead")
  .argument("<file>", "Workflow YAML file")
  .action(() => {
    process.stderr.write(`Error: Command 'workflow put' has been removed.
Use 'workflow add' instead.

For more information, see: uwf help workflow add
`);
    process.exit(1);
  });

thread
  .command("step")
  .description("[DEPRECATED] Use 'thread exec' instead")
  .argument("<thread-id>", "Thread ULID")
  .allowUnknownOption()
  .action(() => {
    process.stderr.write(`Error: Command 'thread step' has been removed.
Use 'thread exec' instead.

For more information, see: uwf help thread exec
`);
    process.exit(1);
  });

thread
  .command("steps")
  .description("[DEPRECATED] Use 'step list' instead")
  .argument("<thread-id>", "Thread ULID")
  .action(() => {
    process.stderr.write(`Error: Command 'thread steps' has been removed.
Use 'step list' instead.

For more information, see: uwf help step list
`);
    process.exit(1);
  });

thread
  .command("step-details")
  .description("[DEPRECATED] Use 'step show' instead")
  .argument("<step-hash>", "Step hash")
  .action(() => {
    process.stderr.write(`Error: Command 'thread step-details' has been removed.
Use 'step show' instead.

For more information, see: uwf help step show
`);
    process.exit(1);
  });

thread
  .command("fork")
  .description("[DEPRECATED] Use 'step fork' instead")
  .argument("<step-hash>", "Step hash")
  .action(() => {
    process.stderr.write(`Error: Command 'thread fork' has been removed.
Use 'step fork' instead.

For more information, see: uwf help step fork
`);
    process.exit(1);
  });

thread
  .command("kill")
  .description("[DEPRECATED] Use 'thread stop' or 'thread cancel' instead")
  .argument("<thread-id>", "Thread ULID")
  .action(() => {
    process.stderr.write(`Error: Command 'thread kill' has been removed.
Use 'thread stop' to stop background execution (keep thread active),
or 'thread cancel' to cancel and archive the thread.

For more information, see:
  uwf help thread stop
  uwf help thread cancel
`);
    process.exit(1);
  });

thread
  .command("running")
  .description("[DEPRECATED] Use 'thread list --status running' instead")
  .action(() => {
    process.stderr.write(`Error: Command 'thread running' has been removed.
Use 'thread list --status running' instead.

For more information, see: uwf help thread list
`);
    process.exit(1);
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
  .command("put-text")
  .description("Store a plain text string, print its hash")
  .argument("<text>", "Text content to store")
  .action((text: string) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      writeOutput(await cmdCasPutText(storageRoot, text));
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

const log = program.command("log").description("Process-level debug logs");

log
  .command("list")
  .description("List log files with sizes")
  .action(() => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const result = await cmdLogList(storageRoot);
      writeOutput(result);
    });
  });

log
  .command("show")
  .description("Show and filter log entries")
  .option("--thread <thread-id>", "Filter by thread ID")
  .option("--process <pid>", "Filter by process ID")
  .option("--date <date>", "Filter by date (YYYY-MM-DD)")
  .action(
    (opts: {
      thread: string | undefined;
      process: string | undefined;
      date: string | undefined;
    }) => {
      const storageRoot = resolveStorageRoot();
      runAction(async () => {
        const result = await cmdLogShow(storageRoot, {
          thread: opts.thread ?? null,
          process: opts.process ?? null,
          date: opts.date ?? null,
        });
        writeOutput(result);
      });
    },
  );

log
  .command("clean")
  .description("Delete log files older than given date")
  .requiredOption("--before <date>", "Delete files before this date (YYYY-MM-DD)")
  .action((opts: { before: string }) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const result = await cmdLogClean(storageRoot, opts.before);
      writeOutput(result);
    });
  });

program.parseAsync(process.argv).catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
