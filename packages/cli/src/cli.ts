#!/usr/bin/env -S node --disable-warning=ExperimentalWarning

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCLI, type ParsedFlags } from "@ocas/cli-kit";
import type { CasRef, OutputSchemaName, ThreadId, ThreadStatus } from "@united-workforce/protocol";
import { z } from "zod";
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

// --- Package version (readFileSync replaces dynamic import) ---

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")) as {
  version: string;
};
const VERSION = pkg.version;

// --- Module-level state (cli-kit v0.2.1 workaround: no global --format) ---
// Parsed from argv early, before cli-kit sees it.
let formatOverride: string | null = null;
// Parsed from argv early — cli-kit rejects values starting with `-`.
let countOverride: string | null = null;

function getFormat(): OutputFormat {
  const raw = formatOverride ?? "text";
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
function writeRawOutput(data: unknown, commandPath: string | null = null): void {
  const fmt = getFormat();
  process.stdout.write(`${formatOutput(data, fmt, commandPath ?? undefined)}\n`);
}

function runAction(action: () => Promise<void>): Promise<void> {
  return action().catch((e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}

// --- Helper functions for thread list / step turns parsing (unchanged) ---

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

/**
 * Parse a `step turns` `--limit`/`--offset` value into a non-negative integer, or
 * `null` when the flag is absent (the OCAS `ListOptions` "no limit" / offset-0
 * convention). `--limit 0` is a legal value (renders no turns); negative or
 * non-numeric values are a CLI usage error (exit non-zero). The `flag` label is
 * used verbatim in the error message.
 */
function parseTurnsPageOption(flag: string, value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    process.stderr.write(`${flag} must be a non-negative integer\n`);
    process.exit(1);
  }
  return Number.parseInt(trimmed, 10);
}

/**
 * Resolve `thread list` pagination from both the canonical repo-wide
 * `ListOptions` vocabulary (`--limit`/`--offset`, as used by `step turns`) and
 * the backward-compatible legacy aliases (`--skip`/`--take`). The canonical
 * flags map onto the existing `cmdThreadList` parameters: `--limit` → `take`
 * (max items), `--offset` → `skip` (items skipped from the front of the
 * newest-first list). When both a canonical flag and its legacy alias are
 * supplied, the canonical flag wins and the alias is the fallback.
 * `--limit`/`--offset` are validated via `parseTurnsPageOption` (same
 * non-negative-integer rule and flag-named error as `step turns`); `--limit 0`
 * is legal and yields no items (the `ListOptions` "no limit" convention treats
 * an absent flag, not 0, as "all items").
 */
function resolveThreadListPagination(flags: {
  skip: string | undefined;
  take: string | undefined;
  limit: string | undefined;
  offset: string | undefined;
}): { skip: number | null; take: number | null } {
  const legacy = parsePaginationOptions(flags.skip, flags.take);
  const limit = parseTurnsPageOption("--limit", flags.limit);
  const offset = parseTurnsPageOption("--offset", flags.offset);
  return {
    skip: offset ?? legacy.skip,
    take: limit ?? legacy.take,
  };
}

// --- Positional arg helper (cli-kit workaround: custom missing-arg message) ---
// cli-kit emits "Missing positional arguments" as NDJSON; tests expect a
// plain "missing required argument" message on stderr. We don't declare
// .arg() on commands and read positionals from the _positionals field that
// cli-kit injects into the flags object.

function getPositionals(flags: ParsedFlags): string[] {
  const p = flags._positionals;
  return Array.isArray(p) ? (p as string[]) : [];
}

function requirePositional(flags: ParsedFlags, index: number, name: string): string {
  const positionals = getPositionals(flags);
  const value = positionals[index];
  if (value === undefined) {
    process.stderr.write(`Error: missing required argument: ${name}\n`);
    process.exit(1);
  }
  return value;
}

// --- Help text (cli-kit v0.2.1 workaround: no per-command --help) ---

const TOP_LEVEL_HELP = `Usage: uwf <command> [options]

Stateless workflow CLI

Four-layer architecture:
  workflow → thread → step → turn

Commands:
  workflow    Workflow definitions (layer 1: templates)
  thread      Thread execution (layer 2: instances)
  step        Step results (layer 3: single cycle)
  prompt      Built-in prompt references for agents
  setup       Configure the default agent
  log         Process-level debug logs
  config      Configuration management

Standard flags:
  --format <fmt>    Output format: text (default), json, yaml, raw-json, raw-yaml
  -V, --version     Show version
  -h, --help        Show this help
`;

const PROMPT_HELP = `Usage: uwf prompt <command>

Built-in prompt references for agents

Commands:
  usage                Print the usage reference (CLI guide + typical workflows)
  bootstrap            Print setup instructions for installing uwf skills
  workflow-authoring   Print the workflow authoring reference (YAML design guide)
  adapter-developing   Print the adapter developing reference (building agent adapters)
  list                 List all available prompt names
`;

const WORKFLOW_HELP = `Usage: uwf workflow <command>

Workflow definitions (layer 1: templates)

Commands:
  add       Register a workflow from YAML
  validate  Validate a workflow YAML without registering it (CI-friendly)
  show      Show a workflow by name or CAS hash
  list      List registered workflows
`;

const WORKFLOW_ADD_HELP = `Usage: uwf workflow add <file>

Register a workflow from YAML

Arguments:
  file  Workflow YAML file
`;

const WORKFLOW_VALIDATE_HELP = `Usage: uwf workflow validate <file>

Validate a workflow YAML without registering it (CI-friendly)

Arguments:
  file  Workflow YAML file
`;

const WORKFLOW_SHOW_HELP = `Usage: uwf workflow show <id>

Show a workflow by name or CAS hash

Arguments:
  id  Workflow name or hash
`;

const WORKFLOW_LIST_HELP = `Usage: uwf workflow list

List registered workflows
`;

const THREAD_HELP = `Usage: uwf thread <command>

Thread execution (layer 2: instances)

Commands:
  start    Create a thread without executing
  exec     Execute one or more steps
  show     Show thread head pointer
  list     List threads (defaults to active: idle + running + corrupt)
  resume   Resume a suspended thread and re-run the suspended role
  poke     Re-run the head step's agent with a supplementary prompt
  stop     Stop background execution of a thread (keep thread active)
  cancel   Cancel a thread (stop execution and move to history)
  join     Block until a running thread finishes, then return the final result
  read     Read thread context as human-readable markdown
`;

const THREAD_START_HELP = `Usage: uwf thread start <workflow> [options]

Create a thread without executing

Arguments:
  workflow  Workflow name or hash

Options:
  -p, --prompt <text>  User prompt (required)
  --cwd <path>         Working directory for thread execution (default: process.cwd())
`;

const THREAD_EXEC_HELP = `Usage: uwf thread exec <thread-id> [options]

Execute one or more steps

Arguments:
  thread-id  Thread ULID

Options:
  --agent <cmd>          Override agent command
  -c, --count <number>   Number of steps to run (default: 1)
  --background           Run in background and return immediately
`;

const THREAD_SHOW_HELP = `Usage: uwf thread show <thread-id>

Show thread head pointer

Arguments:
  thread-id  Thread ULID
`;

const THREAD_LIST_HELP = `Usage: uwf thread list [options]

List threads (defaults to active: idle + running + corrupt)

Options:
  --status <status>   Filter by status: idle, running, end, cancelled, active, or comma-separated
  --all               Show all threads regardless of status
  --after <date>      Filter threads created after this date
  --before <date>     Filter threads created before this date
  --limit <n>         Return at most n threads (newest first)
  --offset <m>        Skip the first m threads (newest first)
  --take <n>          Alias for --limit
  --skip <n>          Alias for --offset
`;

const THREAD_RESUME_HELP = `Usage: uwf thread resume <thread-id> [options]

Resume a suspended thread and re-run the suspended role

Arguments:
  thread-id  Thread ULID

Options:
  -p, --prompt <text>  Supplementary info to append to the resume prompt
  --agent <cmd>        Override agent command
`;

const THREAD_POKE_HELP = `Usage: uwf thread poke <thread-id> [options]

Re-run the head step's agent with a supplementary prompt (replaces head step)

Arguments:
  thread-id  Thread ULID

Options:
  -p, --prompt <text>  Supplementary prompt for the agent (required)
  --agent <cmd>        Override agent command (defaults to head step's agent)
`;

const THREAD_STOP_HELP = `Usage: uwf thread stop <thread-id>

Stop background execution of a thread (keep thread active)

Arguments:
  thread-id  Thread ULID
`;

const THREAD_CANCEL_HELP = `Usage: uwf thread cancel <thread-id>

Cancel a thread (stop execution and move to history)

Arguments:
  thread-id  Thread ULID
`;

const THREAD_JOIN_HELP = `Usage: uwf thread join <thread-id> [options]

Block until a running thread finishes, then return the final result

Arguments:
  thread-id  Thread ULID

Options:
  --timeout <seconds>  Max seconds to wait before giving up
`;

const THREAD_READ_HELP = `Usage: uwf thread read <thread-id> [options]

Read thread context as human-readable markdown

Arguments:
  thread-id  Thread ULID

Options:
  --quota <chars>       Max output characters
  --before <step-hash>  Load steps before this hash (exclusive)
  --start               Include start step in output
`;

const STEP_HELP = `Usage: uwf step <command>

Step results (layer 3: single cycle)

Commands:
  list   List all steps in a thread
  show   Show details of a specific step
  ask    Ask a follow-up question to a historical step's agent
  read   Read a step's turns as human-readable markdown
  turns  Show all turns across a thread's steps
  fork   Fork a thread from a specific step
`;

const STEP_LIST_HELP = `Usage: uwf step list <thread-id>

List all steps in a thread

Arguments:
  thread-id  Thread ULID
`;

const STEP_SHOW_HELP = `Usage: uwf step show <step-hash>

Show details of a specific step

Arguments:
  step-hash  CAS hash of the StepNode
`;

const STEP_ASK_HELP = `Usage: uwf step ask <step-hash> [options]

Ask a follow-up question to a historical step's agent (read-only; no thread mutation)

Arguments:
  step-hash  CAS hash of the StepNode to query

Options:
  -p, --prompt <text>  Question to ask the step's agent (required)
  --agent <cmd>        Override agent command
  --no-fork            Skip session-fork; spawn fresh ask session
`;

const STEP_READ_HELP = `Usage: uwf step read <step-hash> [options]

Read a step's turns as human-readable markdown

Arguments:
  step-hash  CAS hash of the StepNode

Options:
  --quota <chars>  Max output characters (default: 4000)
  --prompt         Show the assembled prompt sent to the agent
`;

const STEP_TURNS_HELP = `Usage: uwf step turns <thread-id> [options]

Show all turns across a thread's steps (the whole-chain panorama)

Arguments:
  thread-id  Thread ULID

Options:
  --role <role>    Filter to one role's steps across the whole chain
  --live           Follow the in-flight step's turns
  --limit <n>      Max turns to show from the flattened cross-step sequence
  --offset <n>     Skip the first N turns of the flattened cross-step sequence
`;

const STEP_FORK_HELP = `Usage: uwf step fork <step-hash>

Fork a thread from a specific step

Arguments:
  step-hash  CAS hash of the StartNode or StepNode to fork from
`;

const SETUP_HELP = `Usage: uwf setup [options]

Configure the default agent. Run without --agent for interactive wizard.

Options:
  --agent <name>  Default agent adapter (e.g. builtin, or a Sumeru gateway alias)
`;

const LOG_HELP = `Usage: uwf log <command>

Process-level debug logs

Commands:
  list   List log files with sizes
  show   Show and filter log entries
  clean  Delete log files older than given date
`;

const LOG_LIST_HELP = `Usage: uwf log list

List log files with sizes
`;

const LOG_SHOW_HELP = `Usage: uwf log show [options]

Show and filter log entries

Options:
  --thread <thread-id>  Filter by thread ID
  --process <pid>       Filter by process ID
  --date <date>         Filter by date (YYYY-MM-DD)
`;

const LOG_CLEAN_HELP = `Usage: uwf log clean --before <date>

Delete log files older than given date

Options:
  --before <date>  Delete files before this date (YYYY-MM-DD) (required)
`;

const CONFIG_HELP = `Usage: uwf config <command>

Configuration management

Commands:
  list  Display all configuration values (masks API keys)
  get   Get a specific configuration value
  set   Set a specific configuration value
`;

const CONFIG_LIST_HELP = `Usage: uwf config list

Display all configuration values (masks API keys)
`;

const CONFIG_GET_HELP = `Usage: uwf config get <key>

Get a specific configuration value

Arguments:
  key  Dot-notation path to config value
`;

const CONFIG_SET_HELP = `Usage: uwf config set <key> <value>

Set a specific configuration value

Arguments:
  key    Dot-notation path to config value
  value  New value (use JSON array for 'args' key)
`;

const HELP_MAP: Record<string, string> = {
  "": TOP_LEVEL_HELP,
  prompt: PROMPT_HELP,
  workflow: WORKFLOW_HELP,
  "workflow add": WORKFLOW_ADD_HELP,
  "workflow validate": WORKFLOW_VALIDATE_HELP,
  "workflow show": WORKFLOW_SHOW_HELP,
  "workflow list": WORKFLOW_LIST_HELP,
  thread: THREAD_HELP,
  "thread start": THREAD_START_HELP,
  "thread exec": THREAD_EXEC_HELP,
  "thread show": THREAD_SHOW_HELP,
  "thread list": THREAD_LIST_HELP,
  "thread resume": THREAD_RESUME_HELP,
  "thread poke": THREAD_POKE_HELP,
  "thread stop": THREAD_STOP_HELP,
  "thread cancel": THREAD_CANCEL_HELP,
  "thread join": THREAD_JOIN_HELP,
  "thread read": THREAD_READ_HELP,
  step: STEP_HELP,
  "step list": STEP_LIST_HELP,
  "step show": STEP_SHOW_HELP,
  "step ask": STEP_ASK_HELP,
  "step read": STEP_READ_HELP,
  "step turns": STEP_TURNS_HELP,
  "step fork": STEP_FORK_HELP,
  setup: SETUP_HELP,
  log: LOG_HELP,
  "log list": LOG_LIST_HELP,
  "log show": LOG_SHOW_HELP,
  "log clean": LOG_CLEAN_HELP,
  config: CONFIG_HELP,
  "config list": CONFIG_LIST_HELP,
  "config get": CONFIG_GET_HELP,
  "config set": CONFIG_SET_HELP,
};

// --- Early intercepts (cli-kit v0.2.1 workarounds) ---

/** Print help text for the command path extracted from argv, then exit. */
function printHelp(argv: string[]): void {
  const helpIdx = argv.findIndex((t) => t === "--help" || t === "-h");
  const tokens = helpIdx >= 0 ? argv.slice(0, helpIdx).filter((t) => !t.startsWith("-")) : [];
  for (let len = tokens.length; len >= 0; len--) {
    const path = tokens.slice(0, len).join(" ");
    const text = HELP_MAP[path];
    if (text !== undefined) {
      process.stdout.write(text);
      process.exit(0);
    }
  }
  process.stdout.write(TOP_LEVEL_HELP);
  process.exit(0);
}

/** Intercept deprecated commands before cli-kit parsing. Prints message + exit(1). */
function handleDeprecated(argv: string[]): void {
  const [cmd, sub] = argv;
  if (cmd === "workflow" && sub === "put") {
    process.stderr.write(`Error: Command 'workflow put' has been removed.
Use 'workflow add' instead.

For more information, see: uwf help workflow add
`);
    process.exit(1);
  }
  if (cmd === "thread") {
    if (sub === "step") {
      process.stderr.write(`Error: Command 'thread step' has been removed.
Use 'thread exec' instead.

For more information, see: uwf help thread exec
`);
      process.exit(1);
    }
    if (sub === "steps") {
      process.stderr.write(`Error: Command 'thread steps' has been removed.
Use 'step list' instead.

For more information, see: uwf help step list
`);
      process.exit(1);
    }
    if (sub === "step-details") {
      process.stderr.write(`Error: Command 'thread step-details' has been removed.
Use 'step show' instead.

For more information, see: uwf help step show
`);
      process.exit(1);
    }
    if (sub === "fork") {
      process.stderr.write(`Error: Command 'thread fork' has been removed.
Use 'step fork' instead.

For more information, see: uwf help step fork
`);
      process.exit(1);
    }
    if (sub === "kill") {
      process.stderr.write(`Error: Command 'thread kill' has been removed.
Use 'thread stop' to stop background execution (keep thread active),
or 'thread cancel' to cancel and archive the thread.

For more information, see:
  uwf help thread stop
  uwf help thread cancel
`);
      process.exit(1);
    }
    if (sub === "running") {
      process.stderr.write(`Error: Command 'thread running' has been removed.
Use 'thread list --status running' instead.

For more information, see: uwf help thread list
`);
      process.exit(1);
    }
  }
}

/** Strip `--format <value>` / `--format=value` from argv, returning cleaned argv. */
function stripFormatFlag(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--format") {
      const value = argv[i + 1];
      if (value !== undefined) {
        formatOverride = value;
        i++;
      }
      continue;
    }
    if (token.startsWith("--format=")) {
      formatOverride = token.slice("--format=".length);
      continue;
    }
    out.push(token);
  }
  return out;
}

/** Strip `--count <value>` / `--count=value` / `-c <value>` from argv. */
function stripCountFlag(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--count" || token === "-c") {
      const value = argv[i + 1];
      if (value !== undefined) {
        countOverride = value;
        i++;
      }
      continue;
    }
    if (token.startsWith("--count=")) {
      countOverride = token.slice("--count=".length);
      continue;
    }
    out.push(token);
  }
  return out;
}

// --- Build CLI with @ocas/cli-kit ---

const cli = createCLI({
  name: "uwf",
  version: VERSION,
});

const unknownSchema = z.unknown();

// ── workflow group ───────────────────────────────────────────────────────────

const workflow = cli.command("workflow");

workflow
  .command("add")
  .returns(unknownSchema, "")
  .action(async (_args, flags) => {
    const file = requirePositional(flags, 0, "file");
    const storageRoot = resolveStorageRoot();
    await runAction(async () => {
      const result = await cmdWorkflowAdd(storageRoot, file);
      await writeOutput(toWorkflowAddPayload(result), "workflow-add", storageRoot);
    });
    return undefined;
  });

workflow
  .command("validate")
  .returns(unknownSchema, "")
  .action(async (_args, flags) => {
    const file = requirePositional(flags, 0, "file");
    const storageRoot = resolveStorageRoot();
    await runAction(async () => {
      const errors = await cmdWorkflowValidate(file);
      await writeOutput(toValidateResultPayload(errors), "validate-result", storageRoot);
      if (errors.length > 0) {
        process.exit(1);
      }
    });
    return undefined;
  });

workflow
  .command("show")
  .returns(unknownSchema, "")
  .action(async (_args, flags) => {
    const id = requirePositional(flags, 0, "id");
    const storageRoot = resolveStorageRoot();
    await runAction(async () => {
      const result = await cmdWorkflowShow(storageRoot, id, process.cwd());
      await writeOutput(toWorkflowDetailPayload(result), "workflow-detail", storageRoot);
    });
    return undefined;
  });

workflow
  .command("list")
  .returns(unknownSchema, "")
  .action(async () => {
    const storageRoot = resolveStorageRoot();
    await runAction(async () => {
      const result = await cmdWorkflowList(storageRoot, process.cwd());
      await writeOutput(toWorkflowListPayload(result), "workflow-list", storageRoot);
    });
    return undefined;
  });

// ── thread group ─────────────────────────────────────────────────────────────

const thread = cli.command("thread");

thread
  .command("start")
  .flag("prompt", { type: "string" })
  .flag("p", { type: "string" })
  .flag("cwd", { type: "string" })
  .returns(unknownSchema, "")
  .action(async (_args, flags) => {
    const workflowName = requirePositional(flags, 0, "workflow");
    const prompt = (flags.prompt as string | undefined) ?? (flags.p as string | undefined);
    if (prompt === undefined) {
      process.stderr.write("Error: missing required option: -p, --prompt <text>\n");
      process.exit(1);
    }
    const storageRoot = resolveStorageRoot();
    await runAction(async () => {
      const result = await cmdThreadStart(
        storageRoot,
        workflowName,
        prompt,
        process.cwd(),
        (flags.cwd as string | undefined) ?? process.cwd(),
      );
      await writeOutput(toThreadStartPayload(result), "thread-start", storageRoot);
    });
    return undefined;
  });

thread
  .command("exec")
  .flag("agent", { type: "string" })
  .flag("background", { type: "boolean", default: false })
  .flag("_background-worker", { type: "boolean", default: false })
  .returns(unknownSchema, "")
  .action(async (_args, flags) => {
    const threadId = requirePositional(flags, 0, "thread-id");
    const storageRoot = resolveStorageRoot();
    await runAction(async () => {
      const agentOverride = (flags.agent as string | undefined) ?? null;
      const count = countOverride !== null ? Number(countOverride) : 1;
      const background = flags.background as boolean;
      const backgroundWorker = (flags["_background-worker"] as boolean) ?? false;
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
    return undefined;
  });

thread
  .command("show")
  .returns(unknownSchema, "")
  .action(async (_args, flags) => {
    const threadId = requirePositional(flags, 0, "thread-id");
    const storageRoot = resolveStorageRoot();
    await runAction(async () => {
      const result = await cmdThreadShow(storageRoot, threadId);
      await writeOutput(toThreadStatusPayload(result), "thread-status", storageRoot);
    });
    return undefined;
  });

thread
  .command("list")
  .flag("status", { type: "string" })
  .flag("all", { type: "boolean", default: false })
  .flag("after", { type: "string" })
  .flag("before", { type: "string" })
  .flag("skip", { type: "string" })
  .flag("take", { type: "string" })
  .flag("limit", { type: "string" })
  .flag("offset", { type: "string" })
  .returns(unknownSchema, "")
  .action(async (_args, flags) => {
    const storageRoot = resolveStorageRoot();
    await runAction(async () => {
      const statusFilter = parseStatusFilter(flags.status as string | undefined);
      const nowMs = Date.now();
      const { afterMs, beforeMs } = parseTimeFilters(
        flags.after as string | undefined,
        flags.before as string | undefined,
        nowMs,
      );
      const { skip, take } = resolveThreadListPagination({
        skip: flags.skip as string | undefined,
        take: flags.take as string | undefined,
        limit: flags.limit as string | undefined,
        offset: flags.offset as string | undefined,
      });
      const showAll = flags.all === true;
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
    return undefined;
  });

thread
  .command("resume")
  .flag("prompt", { type: "string" })
  .flag("p", { type: "string" })
  .flag("agent", { type: "string" })
  .returns(unknownSchema, "")
  .action(async (_args, flags) => {
    const threadId = requirePositional(flags, 0, "thread-id") as ThreadId;
    const storageRoot = resolveStorageRoot();
    const prompt = (flags.prompt as string | undefined) ?? (flags.p as string | undefined);
    await runAction(async () => {
      const supplement = prompt ?? null;
      const agentOverride = (flags.agent as string | undefined) ?? null;
      const result = await cmdThreadResume(storageRoot, threadId, supplement, agentOverride);
      await writeOutput(toThreadStatusPayload(result), "thread-status", storageRoot);
    });
    return undefined;
  });

thread
  .command("poke")
  .flag("prompt", { type: "string" })
  .flag("p", { type: "string" })
  .flag("agent", { type: "string" })
  .returns(unknownSchema, "")
  .action(async (_args, flags) => {
    const threadId = requirePositional(flags, 0, "thread-id") as ThreadId;
    const prompt = (flags.prompt as string | undefined) ?? (flags.p as string | undefined);
    if (prompt === undefined) {
      process.stderr.write("Error: missing required option: -p, --prompt <text>\n");
      process.exit(1);
    }
    const storageRoot = resolveStorageRoot();
    await runAction(async () => {
      const agentOverride = (flags.agent as string | undefined) ?? null;
      const result = await cmdThreadPoke(storageRoot, threadId, prompt, agentOverride);
      await writeOutput(toThreadStatusPayload(result), "thread-status", storageRoot);
    });
    return undefined;
  });

thread
  .command("stop")
  .returns(unknownSchema, "")
  .action(async (_args, flags) => {
    const threadId = requirePositional(flags, 0, "thread-id");
    const storageRoot = resolveStorageRoot();
    await runAction(async () => {
      const result = await cmdThreadStop(storageRoot, threadId);
      writeRawOutput(result, "thread stop");
    });
    return undefined;
  });

thread
  .command("cancel")
  .returns(unknownSchema, "")
  .action(async (_args, flags) => {
    const threadId = requirePositional(flags, 0, "thread-id");
    const storageRoot = resolveStorageRoot();
    await runAction(async () => {
      const result = await cmdThreadCancel(storageRoot, threadId);
      writeRawOutput(result, "thread cancel");
    });
    return undefined;
  });

thread
  .command("join")
  .flag("timeout", { type: "string" })
  .returns(unknownSchema, "")
  .action(async (_args, flags) => {
    const threadId = requirePositional(flags, 0, "thread-id");
    const storageRoot = resolveStorageRoot();
    await runAction(async () => {
      const timeoutRaw = flags.timeout as string | undefined;
      const timeoutMs = timeoutRaw !== undefined ? Number(timeoutRaw) * 1000 : null;
      if (timeoutMs !== null && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
        process.stderr.write("invalid --timeout: must be a positive number\n");
        process.exit(1);
      }
      const results = await cmdThreadJoin(storageRoot, threadId, timeoutMs);
      await writeOutput(toThreadExecPayload(results), "thread-exec", storageRoot);
    });
    return undefined;
  });

thread
  .command("read")
  .flag("quota", { type: "string", default: String(THREAD_READ_DEFAULT_QUOTA) })
  .flag("before", { type: "string" })
  .flag("start", { type: "boolean", default: false })
  .returns(unknownSchema, "")
  .action(async (_args, flags) => {
    const threadId = requirePositional(flags, 0, "thread-id") as ThreadId;
    const storageRoot = resolveStorageRoot();
    await runAction(async () => {
      const quota = Number.parseInt(flags.quota as string, 10);
      if (!Number.isFinite(quota) || quota < 1) {
        process.stderr.write("invalid --quota: must be a positive integer\n");
        process.exit(1);
      }
      const before = (flags.before as string | undefined) ?? null;
      const markdown = await cmdThreadRead(
        storageRoot,
        threadId,
        quota,
        before,
        (flags.start as boolean) ?? false,
      );
      process.stdout.write(markdown.endsWith("\n") ? markdown : `${markdown}\n`);
    });
    return undefined;
  });

// ── step group ───────────────────────────────────────────────────────────────

const step = cli.command("step");

step
  .command("list")
  .returns(unknownSchema, "")
  .action(async (_args, flags) => {
    const threadId = requirePositional(flags, 0, "thread-id");
    const storageRoot = resolveStorageRoot();
    await runAction(async () => {
      const result = await cmdStepList(storageRoot, threadId);
      await writeOutput(toStepListPayload(result), "step-list", storageRoot);
    });
    return undefined;
  });

step
  .command("show")
  .returns(unknownSchema, "")
  .action(async (_args, flags) => {
    const stepHash = requirePositional(flags, 0, "step-hash") as CasRef;
    const storageRoot = resolveStorageRoot();
    await runAction(async () => {
      const detail = await cmdStepShow(storageRoot, stepHash);
      await writeOutput(toStepDetailPayload(stepHash, detail), "step-detail", storageRoot);
    });
    return undefined;
  });

step
  .command("ask")
  .flag("prompt", { type: "string" })
  .flag("p", { type: "string" })
  .flag("agent", { type: "string" })
  .flag("no-fork", { type: "boolean", default: false })
  .returns(unknownSchema, "")
  .action(async (_args, flags) => {
    const stepHash = requirePositional(flags, 0, "step-hash") as CasRef;
    const prompt = (flags.prompt as string | undefined) ?? (flags.p as string | undefined);
    if (prompt === undefined) {
      process.stderr.write("Error: missing required option: -p, --prompt <text>\n");
      process.exit(1);
    }
    const storageRoot = resolveStorageRoot();
    await runAction(async () => {
      const stdout = await cmdStepAsk(storageRoot, stepHash, {
        prompt,
        agentOverride: (flags.agent as string | undefined) ?? null,
        fork: !(flags["no-fork"] as boolean),
      });
      process.stdout.write(stdout.endsWith("\n") ? stdout : `${stdout}\n`);
    });
    return undefined;
  });

step
  .command("read")
  .flag("quota", { type: "string", default: "4000" })
  .flag("prompt", { type: "boolean", default: false })
  .returns(unknownSchema, "")
  .action(async (_args, flags) => {
    const stepHash = requirePositional(flags, 0, "step-hash") as CasRef;
    const storageRoot = resolveStorageRoot();
    await runAction(async () => {
      const quota = Number.parseInt(flags.quota as string, 10);
      if (!Number.isFinite(quota) || quota < 1) {
        process.stderr.write("invalid --quota: must be a positive integer\n");
        process.exit(1);
      }
      const markdown = await cmdStepRead(storageRoot, stepHash, quota, flags.prompt === true);
      process.stdout.write(markdown.endsWith("\n") ? markdown : `${markdown}\n`);
    });
    return undefined;
  });

step
  .command("turns")
  .flag("role", { type: "string" })
  .flag("live", { type: "boolean", default: false })
  .flag("limit", { type: "string" })
  .flag("offset", { type: "string" })
  .returns(unknownSchema, "")
  .action(async (_args, flags) => {
    const threadId = requirePositional(flags, 0, "thread-id") as ThreadId;
    const storageRoot = resolveStorageRoot();
    await runAction(async () => {
      const limit = parseTurnsPageOption("--limit", flags.limit as string | undefined);
      const offset = parseTurnsPageOption("--offset", flags.offset as string | undefined) ?? 0;
      const markdown = await cmdStepTurns(storageRoot, threadId, {
        role: (flags.role as string | undefined) ?? null,
        live: flags.live === true,
        limit,
        offset,
      });
      if (markdown !== "") {
        process.stdout.write(markdown.endsWith("\n") ? markdown : `${markdown}\n`);
      }
    });
    return undefined;
  });

step
  .command("fork")
  .returns(unknownSchema, "")
  .action(async (_args, flags) => {
    const stepHash = requirePositional(flags, 0, "step-hash") as CasRef;
    const storageRoot = resolveStorageRoot();
    await runAction(async () => {
      const result = await cmdStepFork(storageRoot, stepHash);
      writeRawOutput(result);
    });
    return undefined;
  });

// ── prompt group ─────────────────────────────────────────────────────────────

const promptGroup = cli.command("prompt");

promptGroup
  .command("usage")
  .returns(unknownSchema, "")
  .action(async () => {
    console.log(cmdPromptUsage());
    return undefined;
  });

promptGroup
  .command("bootstrap")
  .returns(unknownSchema, "")
  .action(async () => {
    console.log(cmdPromptBootstrap());
    return undefined;
  });

promptGroup
  .command("workflow-authoring")
  .returns(unknownSchema, "")
  .action(async () => {
    console.log(cmdPromptWorkflowAuthoring());
    return undefined;
  });

promptGroup
  .command("adapter-developing")
  .returns(unknownSchema, "")
  .action(async () => {
    console.log(cmdPromptAdapterDeveloping());
    return undefined;
  });

promptGroup
  .command("list")
  .returns(unknownSchema, "")
  .action(async () => {
    console.log(cmdPromptList().join("\n"));
    return undefined;
  });

// ── setup (top-level) ────────────────────────────────────────────────────────

cli
  .command("setup")
  .flag("agent", { type: "string" })
  .returns(unknownSchema, "")
  .action(async (_args, flags) => {
    const storageRoot = resolveStorageRoot();
    const agent = flags.agent as string | undefined;
    await runAction(async () => {
      if (agent !== undefined && agent !== "") {
        const result = await cmdSetup({ agent, storageRoot });
        writeRawOutput(result);
      } else {
        await cmdSetupInteractive(storageRoot);
      }
    });
    return undefined;
  });

// ── log group ────────────────────────────────────────────────────────────────

const log = cli.command("log");

log
  .command("list")
  .returns(unknownSchema, "")
  .action(async () => {
    const storageRoot = resolveStorageRoot();
    await runAction(async () => {
      const result = await cmdLogList(storageRoot);
      writeRawOutput(result, "log list");
    });
    return undefined;
  });

log
  .command("show")
  .flag("thread", { type: "string" })
  .flag("process", { type: "string" })
  .flag("date", { type: "string" })
  .returns(unknownSchema, "")
  .action(async (_args, flags) => {
    const storageRoot = resolveStorageRoot();
    await runAction(async () => {
      const result = await cmdLogShow(storageRoot, {
        thread: (flags.thread as string | undefined) ?? null,
        process: (flags.process as string | undefined) ?? null,
        date: (flags.date as string | undefined) ?? null,
      });
      writeRawOutput(result, "log show");
    });
    return undefined;
  });

log
  .command("clean")
  .flag("before", { type: "string" })
  .returns(unknownSchema, "")
  .action(async (_args, flags) => {
    const before = flags.before as string | undefined;
    if (before === undefined) {
      process.stderr.write("Error: missing required option: --before <date>\n");
      process.exit(1);
    }
    const storageRoot = resolveStorageRoot();
    await runAction(async () => {
      const result = await cmdLogClean(storageRoot, before);
      writeRawOutput(result);
    });
    return undefined;
  });

// ── config group ─────────────────────────────────────────────────────────────

const config = cli.command("config");

config
  .command("list")
  .returns(unknownSchema, "")
  .action(async () => {
    const storageRoot = resolveStorageRoot();
    await runAction(async () => {
      const result = await cmdConfigList(storageRoot);
      writeRawOutput(result, "config list");
    });
    return undefined;
  });

config
  .command("get")
  .returns(unknownSchema, "")
  .action(async (_args, flags) => {
    const key = requirePositional(flags, 0, "key");
    const storageRoot = resolveStorageRoot();
    await runAction(async () => {
      const result = await cmdConfigGet(storageRoot, key);
      writeRawOutput({ value: result }, "config get");
    });
    return undefined;
  });

config
  .command("set")
  .returns(unknownSchema, "")
  .action(async (_args, flags) => {
    const key = requirePositional(flags, 0, "key");
    const value = requirePositional(flags, 1, "value");
    const storageRoot = resolveStorageRoot();
    await runAction(async () => {
      const result = await cmdConfigSet(storageRoot, key, value);
      writeRawOutput(result, "config set");
    });
    return undefined;
  });

// --- Main execution: early intercepts + cli.run() ---

const rawArgv = process.argv.slice(2);

// 1. --version / -V (cli-kit doesn't handle these)
const firstToken = rawArgv[0];
if (firstToken === "--version" || firstToken === "-V") {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

// 2. Strip --format (cli-kit has no global --format; parse into module-level var)
const argvNoFormat = stripFormatFlag(rawArgv);

// 3. --help / -h / no args (cli-kit has no per-command --help)
if (argvNoFormat.length === 0 || argvNoFormat.includes("--help") || argvNoFormat.includes("-h")) {
  printHelp(argvNoFormat);
}

// 4. Deprecated commands (intercept before cli-kit parsing)
handleDeprecated(argvNoFormat);

// 5. Strip --count / -c (cli-kit rejects values starting with `-`)
const argvNoCount = stripCountFlag(argvNoFormat);

// 6. Run cli-kit
const exitCode = await cli.run({ argv: argvNoCount });
if (exitCode !== 0) {
  process.exit(exitCode);
}
