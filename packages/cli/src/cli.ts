#!/usr/bin/env -S node --disable-warning=ExperimentalWarning

import type { CasRef, OutputSchemaName, ThreadId, ThreadStatus } from "@united-workforce/protocol";
import { Command } from "commander";
import { cmdConfigGet, cmdConfigList, cmdConfigSet } from "./commands/config.js";
import { cmdLogClean, cmdLogList, cmdLogShow } from "./commands/log.js";
import {
  cmdPromptAdapterDeveloping,
  cmdPromptBootstrap,
  cmdPromptList,
  cmdPromptUsage,
  cmdPromptWorkflowAuthoring,
} from "./commands/prompt.js";
import { cmdSetup, cmdSetupInteractive } from "./commands/setup.js";
import {
  cmdStepAsk,
  cmdStepFork,
  cmdStepList,
  cmdStepRead,
  cmdStepShow,
  cmdStepTurns,
  resolveDefaultTurnsRole,
} from "./commands/step.js";
import {
  cmdThreadCancel,
  cmdThreadExec,
  cmdThreadJoin,
  cmdThreadList,
  cmdThreadPoke,
  cmdThreadRead,
  cmdThreadResume,
  cmdThreadShow,
  cmdThreadStart,
  cmdThreadStop,
  THREAD_READ_DEFAULT_QUOTA,
} from "./commands/thread.js";
import { parseTimeInput } from "./commands/thread-time-parser.js";
import {
  cmdWorkflowAdd,
  cmdWorkflowList,
  cmdWorkflowShow,
  cmdWorkflowValidate,
} from "./commands/workflow.js";
import {
  formatOutput,
  isOutputFormat,
  type OutputFormat,
  SUPPORTED_FORMATS,
  writeEnvelope,
} from "./format.js";
import {
  toStepDetailPayload,
  toStepListPayload,
  toThreadExecPayload,
  toThreadListPayload,
  toThreadStartPayload,
  toThreadStatusPayload,
  toValidateResultPayload,
  toWorkflowAddPayload,
  toWorkflowDetailPayload,
  toWorkflowListPayload,
} from "./output-mappers.js";
import { createUwfStore, resolveStorageRoot } from "./store.js";

function getFormat(): OutputFormat {
  const raw = program.opts().format as string;
  if (!isOutputFormat(raw)) {
    process.stderr.write(
      `Invalid --format: ${raw}. Must be one of: ${SUPPORTED_FORMATS.join(", ")}\n`,
    );
    process.exit(1);
  }
  return raw;
}

async function writeOutput(
  payload: unknown,
  schemaName: OutputSchemaName,
  storageRoot: string,
): Promise<void> {
  const fmt = getFormat();
  const uwf = await createUwfStore(storageRoot);
  await writeEnvelope(payload, schemaName, {
    format: fmt,
    store: uwf.store,
    schemas: uwf.schemas,
  });
}

/**
 * Legacy raw output for commands without an output schema (log/config/setup).
 * Always emits text/JSON/YAML based on the active --format. For `text`
 * (the default) it renders via the per-command registry when available
 * and falls back to JSON.
 */
function writeRawOutput(data: unknown, commandPath?: string): void {
  const fmt = getFormat();
  process.stdout.write(`${formatOutput(data, fmt, commandPath)}\n`);
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
      "  workflow → thread → step → turn",
  )
  .version(pkg.default.version, "-V, --version");
program.option(
  "--format <fmt>",
  "Output format: text (default), json, yaml, raw-json, raw-yaml",
  "text",
);

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
      await writeOutput(toWorkflowAddPayload(result), "workflow-add", storageRoot);
    });
  });

workflow
  .command("validate")
  .description("Validate a workflow YAML without registering it (CI-friendly)")
  .argument("<file>", "Workflow YAML file")
  .action((file: string) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const errors = await cmdWorkflowValidate(file);
      await writeOutput(toValidateResultPayload(errors), "validate-result", storageRoot);
      if (errors.length > 0) {
        process.exit(1);
      }
    });
  });

workflow
  .command("show")
  .description("Show a workflow by name or CAS hash")
  .argument("<id>", "Workflow name or hash")
  .action((id: string) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const result = await cmdWorkflowShow(storageRoot, id, process.cwd());
      await writeOutput(toWorkflowDetailPayload(result), "workflow-detail", storageRoot);
    });
  });

workflow
  .command("list")
  .description("List registered workflows")
  .action(() => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const result = await cmdWorkflowList(storageRoot, process.cwd());
      await writeOutput(toWorkflowListPayload(result), "workflow-list", storageRoot);
    });
  });

const thread = program.command("thread").description("Thread execution (layer 2: instances)");

thread
  .command("start")
  .description("Create a thread without executing")
  .argument("<workflow>", "Workflow name or hash")
  .requiredOption("-p, --prompt <text>", "User prompt")
  .option("--cwd <path>", "Working directory for thread execution (default: process.cwd())")
  .action((workflow: string, opts: { prompt: string; cwd: string | undefined }) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const result = await cmdThreadStart(
        storageRoot,
        workflow,
        opts.prompt,
        process.cwd(),
        opts.cwd ?? process.cwd(),
      );
      await writeOutput(toThreadStartPayload(result), "thread-start", storageRoot);
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
        await writeOutput(toThreadExecPayload(results), "thread-exec", storageRoot);
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
      await writeOutput(toThreadStatusPayload(result), "thread-status", storageRoot);
    });
  });

// Helper functions for thread list command parsing
function parseStatusFilter(status: string | undefined): ThreadStatus[] | null {
  if (status === undefined) return null;
  const raw = status.trim();
  if (raw === "active") return ["idle", "running"];

  const parts = raw.split(",").map((s) => s.trim());
  const validStatuses: ThreadStatus[] = [
    "idle",
    "running",
    "suspended",
    "end",
    "cancelled",
    "corrupt",
  ];
  for (const part of parts) {
    if (!validStatuses.includes(part as ThreadStatus)) {
      process.stderr.write(
        `Invalid status: ${part}. Must be one of: idle, running, suspended, end, cancelled, active\n`,
      );
      process.exit(1);
    }
  }
  return parts as ThreadStatus[];
}

function parseTimeFilters(
  after: string | undefined,
  before: string | undefined,
  nowMs: number,
): { afterMs: number | null; beforeMs: number | null } {
  try {
    const afterMs = after !== undefined ? parseTimeInput(after, nowMs) : null;
    const beforeMs = before !== undefined ? parseTimeInput(before, nowMs) : null;
    return { afterMs, beforeMs };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

function parsePaginationOptions(
  skip: string | undefined,
  take: string | undefined,
): { skip: number | null; take: number | null } {
  let skipVal: number | null = null;
  let takeVal: number | null = null;

  if (skip !== undefined) {
    skipVal = Number.parseInt(skip, 10);
    if (!Number.isInteger(skipVal) || skipVal < 0) {
      process.stderr.write("--skip must be a non-negative integer\n");
      process.exit(1);
    }
  }
  if (take !== undefined) {
    takeVal = Number.parseInt(take, 10);
    if (!Number.isInteger(takeVal) || takeVal < 1) {
      process.stderr.write("--take must be a positive integer\n");
      process.exit(1);
    }
  }
  return { skip: skipVal, take: takeVal };
}

thread
  .command("list")
  .description("List threads (defaults to active: idle + running + corrupt)")
  .option(
    "--status <status>",
    "Filter by status: idle, running, end, cancelled, active (idle+running), or comma-separated values",
  )
  .option("--all", "Show all threads regardless of status (overrides default active-only filter)")
  .option("--after <date>", "Filter threads created after this date (ISO or relative like '7d')")
  .option("--before <date>", "Filter threads created before this date (ISO or relative like '7d')")
  .option("--skip <n>", "Skip first n threads")
  .option("--take <n>", "Return at most n threads")
  .action(
    (opts: {
      status: string | undefined;
      all: boolean | undefined;
      after: string | undefined;
      before: string | undefined;
      skip: string | undefined;
      take: string | undefined;
    }) => {
      const storageRoot = resolveStorageRoot();
      runAction(async () => {
        const statusFilter = parseStatusFilter(opts.status);
        const nowMs = Date.now();
        const { afterMs, beforeMs } = parseTimeFilters(opts.after, opts.before, nowMs);
        const { skip, take } = parsePaginationOptions(opts.skip, opts.take);
        const showAll = opts.all === true;

        const result = await cmdThreadList(
          storageRoot,
          statusFilter,
          afterMs,
          beforeMs,
          skip,
          take,
          showAll,
        );
        await writeOutput(toThreadListPayload(result), "thread-list", storageRoot);
      });
    },
  );

thread
  .command("resume")
  .description("Resume a suspended thread and re-run the suspended role")
  .argument("<thread-id>", "Thread ULID")
  .option("-p, --prompt <text>", "Supplementary info to append to the resume prompt")
  .option("--agent <cmd>", "Override agent command")
  .action((threadId: string, opts: { prompt: string | undefined; agent: string | undefined }) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const supplement = opts.prompt ?? null;
      const agentOverride = opts.agent ?? null;
      const result = await cmdThreadResume(
        storageRoot,
        threadId as ThreadId,
        supplement,
        agentOverride,
      );
      await writeOutput(toThreadStatusPayload(result), "thread-status", storageRoot);
    });
  });

thread
  .command("poke")
  .description("Re-run the head step's agent with a supplementary prompt (replaces head step)")
  .argument("<thread-id>", "Thread ULID")
  .requiredOption("-p, --prompt <text>", "Supplementary prompt for the agent")
  .option("--agent <cmd>", "Override agent command (defaults to head step's agent)")
  .action((threadId: string, opts: { prompt: string; agent: string | undefined }) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const agentOverride = opts.agent ?? null;
      const result = await cmdThreadPoke(
        storageRoot,
        threadId as ThreadId,
        opts.prompt,
        agentOverride,
      );
      await writeOutput(toThreadStatusPayload(result), "thread-status", storageRoot);
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
      writeRawOutput(result, "thread stop");
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
      writeRawOutput(result, "thread cancel");
    });
  });

thread
  .command("join")
  .description("Block until a running thread finishes, then return the final result")
  .argument("<thread-id>", "Thread ULID")
  .option("--timeout <seconds>", "Max seconds to wait before giving up")
  .action((threadId: string, opts: { timeout: string | undefined }) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const timeoutMs = opts.timeout !== undefined ? Number(opts.timeout) * 1000 : null;
      if (timeoutMs !== null && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
        process.stderr.write("invalid --timeout: must be a positive number\n");
        process.exit(1);
      }
      const results = await cmdThreadJoin(storageRoot, threadId, timeoutMs);
      await writeOutput(toThreadExecPayload(results), "thread-exec", storageRoot);
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
      await writeOutput(toStepListPayload(result), "step-list", storageRoot);
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
      await writeOutput(
        toStepDetailPayload(stepHash as CasRef, detail),
        "step-detail",
        storageRoot,
      );
    });
  });

step
  .command("ask")
  .description(
    "Ask a follow-up question to a historical step's agent (read-only; no thread mutation)",
  )
  .argument("<step-hash>", "CAS hash of the StepNode to query")
  .requiredOption("-p, --prompt <text>", "Question to ask the step's agent")
  .option("--agent <cmd>", "Override agent command (defaults to the step's recorded agent)")
  .option(
    "--no-fork",
    "Skip session-fork; spawn the agent in a fresh ask session and inject the step's detail ref for context",
  )
  .action(
    (stepHash: string, opts: { prompt: string; agent: string | undefined; fork: boolean }) => {
      const storageRoot = resolveStorageRoot();
      runAction(async () => {
        const stdout = await cmdStepAsk(storageRoot, stepHash as CasRef, {
          prompt: opts.prompt,
          agentOverride: opts.agent ?? null,
          fork: opts.fork,
        });
        process.stdout.write(stdout.endsWith("\n") ? stdout : `${stdout}\n`);
      });
    },
  );

step
  .command("read")
  .description("Read a step's turns as human-readable markdown")
  .argument("<step-hash>", "CAS hash of the StepNode")
  .option("--quota <chars>", "Max output characters", "4000")
  .option("--prompt", "Show the assembled prompt sent to the agent instead of turns")
  .action((stepHash: string, opts: { quota: string; prompt: boolean }) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const quota = Number.parseInt(opts.quota, 10);
      if (!Number.isFinite(quota) || quota < 1) {
        process.stderr.write("invalid --quota: must be a positive integer\n");
        process.exit(1);
      }
      const markdown = await cmdStepRead(
        storageRoot,
        stepHash as CasRef,
        quota,
        opts.prompt === true,
      );
      process.stdout.write(markdown.endsWith("\n") ? markdown : `${markdown}\n`);
    });
  });

step
  .command("turns")
  .description(
    "Read a step's turns live from the active var, falling back to the completed step detail",
  )
  .argument("<thread-id>", "Thread ULID")
  .option("--role <role>", "Workflow role whose turns to read (defaults to the head step's role)")
  .option("--live", "Follow the running step's turns, printing each new turn as it arrives")
  .action((threadId: string, opts: { role: string | undefined; live: boolean }) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const role = opts.role ?? (await resolveDefaultTurnsRole(storageRoot, threadId as ThreadId));
      const markdown = await cmdStepTurns(storageRoot, threadId as ThreadId, {
        role,
        live: opts.live === true,
      });
      if (markdown !== "") {
        process.stdout.write(markdown.endsWith("\n") ? markdown : `${markdown}\n`);
      }
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
      writeRawOutput(result);
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

const prompt = program.command("prompt").description("Built-in prompt references for agents");
prompt.addHelpCommand(false);

prompt
  .command("usage")
  .description("Print the usage reference (CLI guide + typical workflows)")
  .action(() => {
    console.log(cmdPromptUsage());
  });

prompt
  .command("bootstrap")
  .description("Print setup instructions for installing uwf skills")
  .action(() => {
    console.log(cmdPromptBootstrap());
  });

prompt
  .command("workflow-authoring")
  .description("Print the workflow authoring reference (YAML design guide)")
  .action(() => {
    console.log(cmdPromptWorkflowAuthoring());
  });

prompt
  .command("adapter-developing")
  .description("Print the adapter developing reference (building agent adapters)")
  .action(() => {
    console.log(cmdPromptAdapterDeveloping());
  });

prompt
  .command("list")
  .description("List all available prompt names")
  .action(() => {
    console.log(cmdPromptList().join("\n"));
  });

program
  .command("setup")
  .description(
    "Configure the default agent. Run without --agent for interactive wizard.\n" +
      "Each adapter owns its own LLM configuration — the engine config is LLM-free.",
  )
  .option("--agent <name>", "Default agent adapter (e.g. builtin, or a Sumeru gateway alias)")
  .action((opts: { agent?: string }) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      if (opts.agent !== undefined && opts.agent !== "") {
        const result = await cmdSetup({ agent: opts.agent, storageRoot });
        writeRawOutput(result);
      } else {
        await cmdSetupInteractive(storageRoot);
      }
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
      writeRawOutput(result, "log list");
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
        writeRawOutput(result, "log show");
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
      writeRawOutput(result);
    });
  });

const config = program.command("config").description("Configuration management");

config
  .command("list")
  .description("Display all configuration values (masks API keys)")
  .action(() => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const result = await cmdConfigList(storageRoot);
      writeRawOutput(result, "config list");
    });
  });

config
  .command("get")
  .description("Get a specific configuration value")
  .argument(
    "<key>",
    "Dot-notation path to config value (e.g., defaultAgent, providers.dashscope.baseUrl)",
  )
  .action((key: string) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const result = await cmdConfigGet(storageRoot, key);
      writeRawOutput({ value: result }, "config get");
    });
  });

config
  .command("set")
  .description("Set a specific configuration value")
  .argument("<key>", "Dot-notation path to config value")
  .argument("<value>", "New value (use JSON array for 'args' key, e.g., '[\"--flag\"]')")
  .action((key: string, value: string) => {
    const storageRoot = resolveStorageRoot();
    runAction(async () => {
      const result = await cmdConfigSet(storageRoot, key, value);
      writeRawOutput(result, "config set");
    });
  });

program.parseAsync(process.argv).catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
