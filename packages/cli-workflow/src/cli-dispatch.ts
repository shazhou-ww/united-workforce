import { printCliError, printCliLine, printCliWarn } from "./cli-output.js";
import { cmdAdd, formatAddSuccess, parseAddArgv } from "./cmd-add.js";
import { cmdCasGet, cmdCasList, cmdCasPut, cmdCasRm } from "./cmd-cas.js";
import { cmdFork, parseForkArgv } from "./cmd-fork.js";
import { cmdGc } from "./cmd-gc.js";
import { formatSkillDoc } from "./cmd-help.js";
import { cmdHistory } from "./cmd-history.js";
import { cmdInitTemplate, cmdInitWorkspace } from "./cmd-init.js";
import { cmdKill } from "./cmd-kill.js";
import { cmdList, formatListLines } from "./cmd-list.js";
import { cmdLive } from "./cmd-live.js";
import { cmdPause } from "./cmd-pause.js";
import { cmdPs } from "./cmd-ps.js";
import { cmdRemove } from "./cmd-remove.js";
import { cmdResume } from "./cmd-resume.js";
import { cmdRollback } from "./cmd-rollback.js";
import { cmdRun } from "./cmd-run.js";
import { cmdShow, formatShowYaml } from "./cmd-show.js";
import { cmdThreadRemove, cmdThreadShow } from "./cmd-thread.js";
import { cmdThreads } from "./cmd-threads.js";
import { parseLiveArgv } from "./live-argv.js";
import { parseRunArgv } from "./run-argv.js";

type DispatchFn = (storageRoot: string, argv: string[]) => Promise<number>;

type CommandEntry = {
  handler: DispatchFn;
  args: string;
  description: string;
};

type CommandGroup = {
  name: string;
  commands: ReadonlyArray<{ name: string; args: string; description: string }>;
};

// ── Individual dispatch functions ──────────────────────────────────────

async function dispatchInitWorkspace(_storageRoot: string, argv: string[]): Promise<number> {
  const name = argv[0];
  if (name === undefined || argv.length > 1) {
    printCliError(`${formatCliUsage()}\n\nerror: init workspace requires <name>`);
    return 1;
  }
  const result = await cmdInitWorkspace(process.cwd(), name);
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }
  printCliLine(`initialized workflow workspace at ${result.value.rootPath}`);
  return 0;
}

async function dispatchInitTemplate(_storageRoot: string, argv: string[]): Promise<number> {
  const name = argv[0];
  if (name === undefined || argv.length > 1) {
    printCliError(`${formatCliUsage()}\n\nerror: init template requires <name>`);
    return 1;
  }
  const result = await cmdInitTemplate(process.cwd(), name);
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }
  printCliLine(`initialized template at ${result.value.templatePath}`);
  return 0;
}

async function dispatchAdd(storageRoot: string, argv: string[]): Promise<number> {
  const parsed = parseAddArgv(argv);
  if (!parsed.ok) {
    printCliError(`${formatCliUsage()}\n\nerror: ${parsed.error}`);
    return 1;
  }
  const result = await cmdAdd(storageRoot, parsed.value);
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }
  for (const w of result.value.warnings) {
    printCliWarn(w);
  }
  printCliLine(formatAddSuccess(parsed.value.name, parsed.value.filePath, result.value.hash));
  return 0;
}

async function dispatchList(storageRoot: string, argv: string[]): Promise<number> {
  if (argv.length > 0) {
    printCliError(`${formatCliUsage()}\n\nerror: list takes no arguments`);
    return 1;
  }
  const result = await cmdList(storageRoot);
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }
  for (const line of formatListLines(result.value)) {
    printCliLine(line);
  }
  return 0;
}

async function dispatchShow(storageRoot: string, argv: string[]): Promise<number> {
  const name = argv[0];
  if (name === undefined || argv.length > 1) {
    printCliError(`${formatCliUsage()}\n\nerror: show requires <name>`);
    return 1;
  }
  const result = await cmdShow(storageRoot, name);
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }
  printCliLine(formatShowYaml(name, result.value));
  return 0;
}

async function dispatchRemove(storageRoot: string, argv: string[]): Promise<number> {
  const name = argv[0];
  if (name === undefined || argv.length > 1) {
    printCliError(`${formatCliUsage()}\n\nerror: remove requires <name>`);
    return 1;
  }
  const result = await cmdRemove(storageRoot, name);
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }
  printCliLine(`removed workflow "${name}" from registry`);
  return 0;
}

async function dispatchRun(storageRoot: string, argv: string[]): Promise<number> {
  const parsed = parseRunArgv(argv);
  if (!parsed.ok) {
    printCliError(`${formatCliUsage()}\n\nerror: ${parsed.error}`);
    return 1;
  }

  const result = await cmdRun(
    storageRoot,
    parsed.value.name,
    parsed.value.prompt,
    parsed.value.maxRounds,
  );
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }

  printCliLine(result.value.threadId);
  return 0;
}

async function dispatchPs(storageRoot: string, argv: string[]): Promise<number> {
  if (argv.length > 0) {
    printCliError(`${formatCliUsage()}\n\nerror: ps takes no arguments`);
    return 1;
  }
  for (const line of await cmdPs(storageRoot)) {
    printCliLine(line);
  }
  return 0;
}

async function dispatchKill(storageRoot: string, argv: string[]): Promise<number> {
  const threadId = argv[0];
  if (threadId === undefined || argv.length > 1) {
    printCliError(`${formatCliUsage()}\n\nerror: kill requires <thread-id>`);
    return 1;
  }
  const result = await cmdKill(storageRoot, threadId);
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }
  printCliLine(`kill sent for thread ${threadId}`);
  return 0;
}

async function dispatchLive(storageRoot: string, argv: string[]): Promise<number> {
  const parsed = parseLiveArgv(argv);
  if (!parsed.ok) {
    printCliError(`${formatCliUsage()}\n\nerror: ${parsed.error}`);
    return 1;
  }
  return cmdLive(storageRoot, parsed.value);
}

async function dispatchHistory(storageRoot: string, argv: string[]): Promise<number> {
  const name = argv[0];
  if (name === undefined || argv.length > 1) {
    printCliError(`${formatCliUsage()}\n\nerror: history requires <name>`);
    return 1;
  }
  const result = await cmdHistory(storageRoot, name);
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }
  for (const line of result.value) {
    printCliLine(line);
  }
  return 0;
}

async function dispatchRollback(storageRoot: string, argv: string[]): Promise<number> {
  const name = argv[0];
  if (name === undefined || argv.length > 2) {
    printCliError(`${formatCliUsage()}\n\nerror: rollback requires <name> [hash]`);
    return 1;
  }
  const hashArg = argv[1];
  const result = await cmdRollback(storageRoot, name, hashArg === undefined ? null : hashArg);
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }
  printCliLine(`rolled back workflow "${name}"`);
  return 0;
}

async function dispatchPause(storageRoot: string, argv: string[]): Promise<number> {
  const threadId = argv[0];
  if (threadId === undefined || argv.length > 1) {
    printCliError(`${formatCliUsage()}\n\nerror: pause requires <thread-id>`);
    return 1;
  }
  const result = await cmdPause(storageRoot, threadId);
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }
  printCliLine(`pause sent for thread ${threadId}`);
  return 0;
}

async function dispatchResume(storageRoot: string, argv: string[]): Promise<number> {
  const threadId = argv[0];
  if (threadId === undefined || argv.length > 1) {
    printCliError(`${formatCliUsage()}\n\nerror: resume requires <thread-id>`);
    return 1;
  }
  const result = await cmdResume(storageRoot, threadId);
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }
  printCliLine(`resume sent for thread ${threadId}`);
  return 0;
}

async function dispatchThreadList(storageRoot: string, argv: string[]): Promise<number> {
  const result = await cmdThreads(storageRoot, argv);
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }
  for (const line of result.value) {
    printCliLine(line);
  }
  return 0;
}

async function dispatchThreadShow(storageRoot: string, argv: string[]): Promise<number> {
  const id = argv[0];
  if (id === undefined || argv.length > 1) {
    printCliError(`${formatCliUsage()}\n\nerror: thread show requires <id>`);
    return 1;
  }
  const result = await cmdThreadShow(storageRoot, id);
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }
  printCliLine(result.value);
  return 0;
}

async function dispatchThreadRm(storageRoot: string, argv: string[]): Promise<number> {
  const id = argv[0];
  if (id === undefined || argv.length > 1) {
    printCliError(`${formatCliUsage()}\n\nerror: thread rm requires <id>`);
    return 1;
  }
  const result = await cmdThreadRemove(storageRoot, id);
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }
  printCliLine(`removed thread ${id}`);
  return 0;
}

async function dispatchGc(storageRoot: string, argv: string[]): Promise<number> {
  if (argv.length > 0) {
    printCliError(`${formatCliUsage()}\n\nerror: gc takes no arguments`);
    return 1;
  }
  const result = await cmdGc(storageRoot);
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }
  const stats = result.value;
  printCliLine(
    `scanned ${stats.scannedThreads} threads, ${stats.activeRefs} active refs, deleted ${stats.deletedEntries} entries`,
  );
  return 0;
}

async function dispatchFork(storageRoot: string, argv: string[]): Promise<number> {
  const parsed = parseForkArgv(argv);
  if (!parsed.ok) {
    printCliError(`${formatCliUsage()}\n\nerror: ${parsed.error}`);
    return 1;
  }
  const result = await cmdFork(storageRoot, parsed.value.threadId, parsed.value.fromRole);
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }
  printCliLine(result.value.threadId);
  return 0;
}

// ── CAS subcommand table ───────────────────────────────────────────────

async function dispatchCasGet(storageRoot: string, rest: string[]): Promise<number> {
  const threadId = rest[0];
  const hash = rest[1];
  if (threadId === undefined || hash === undefined || rest.length > 2) {
    printCliError(`${formatCliUsage()}\n\nerror: cas get requires <thread-id> <hash>`);
    return 1;
  }
  const result = await cmdCasGet(storageRoot, threadId, hash);
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }
  printCliLine(result.value);
  return 0;
}

async function dispatchCasPut(storageRoot: string, rest: string[]): Promise<number> {
  const threadId = rest[0];
  const content = rest[1];
  if (threadId === undefined || content === undefined || rest.length > 2) {
    printCliError(`${formatCliUsage()}\n\nerror: cas put requires <thread-id> <content>`);
    return 1;
  }
  const result = await cmdCasPut(storageRoot, threadId, content);
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }
  printCliLine(result.value);
  return 0;
}

async function dispatchCasList(storageRoot: string, rest: string[]): Promise<number> {
  const threadId = rest[0];
  if (threadId === undefined || rest.length > 1) {
    printCliError(`${formatCliUsage()}\n\nerror: cas list requires <thread-id>`);
    return 1;
  }
  const result = await cmdCasList(storageRoot, threadId);
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }
  for (const hash of result.value) {
    printCliLine(hash);
  }
  return 0;
}

async function dispatchCasRm(storageRoot: string, rest: string[]): Promise<number> {
  const threadId = rest[0];
  const hash = rest[1];
  if (threadId === undefined || hash === undefined || rest.length > 2) {
    printCliError(`${formatCliUsage()}\n\nerror: cas rm requires <thread-id> <hash>`);
    return 1;
  }
  const result = await cmdCasRm(storageRoot, threadId, hash);
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }
  printCliLine(`removed cas entry ${hash}`);
  return 0;
}

// ── Subcommand tables with metadata ────────────────────────────────────

const WORKFLOW_SUBCOMMAND_TABLE: Record<string, CommandEntry> = {
  add: {
    handler: dispatchAdd,
    args: "<name> <file.esm.js> [--types <path>]",
    description: "Register a workflow bundle in the registry",
  },
  list: { handler: dispatchList, args: "", description: "List all registered workflows" },
  show: {
    handler: dispatchShow,
    args: "<name>",
    description: "Show details of a registered workflow",
  },
  rm: {
    handler: dispatchRemove,
    args: "<name>",
    description: "Remove a workflow from the registry",
  },
  history: {
    handler: dispatchHistory,
    args: "<name>",
    description: "Show version history of a workflow",
  },
  rollback: {
    handler: dispatchRollback,
    args: "<name> [hash]",
    description: "Rollback a workflow to a previous version",
  },
};

const THREAD_SUBCOMMAND_TABLE: Record<string, CommandEntry> = {
  run: {
    handler: dispatchRun,
    args: "<name> [--prompt <text>] [--max-rounds N]",
    description: "Start a new thread executing a workflow",
  },
  list: {
    handler: dispatchThreadList,
    args: "[name]",
    description: "List threads, optionally filtered by workflow name",
  },
  show: { handler: dispatchThreadShow, args: "<id>", description: "Show thread details and state" },
  rm: { handler: dispatchThreadRm, args: "<id>", description: "Remove a thread" },
  fork: {
    handler: dispatchFork,
    args: "<thread-id> [--from-role <role>]",
    description: "Fork a thread, optionally from a specific role",
  },
  ps: { handler: dispatchPs, args: "", description: "List running threads" },
  kill: { handler: dispatchKill, args: "<thread-id>", description: "Kill a running thread" },
  live: {
    handler: dispatchLive,
    args: "<thread-id> [--debug] [--role <name>]",
    description: "Attach to a thread and stream output live",
  },
  pause: { handler: dispatchPause, args: "<thread-id>", description: "Pause a running thread" },
  resume: { handler: dispatchResume, args: "<thread-id>", description: "Resume a paused thread" },
};

const CAS_SUBCOMMAND_TABLE: Record<string, CommandEntry> = {
  get: {
    handler: dispatchCasGet,
    args: "<thread-id> <hash>",
    description: "Retrieve content by hash from a thread's CAS",
  },
  put: {
    handler: dispatchCasPut,
    args: "<thread-id> <content>",
    description: "Store content in a thread's CAS, returns hash",
  },
  list: {
    handler: dispatchCasList,
    args: "<thread-id>",
    description: "List all CAS entries for a thread",
  },
  rm: { handler: dispatchCasRm, args: "<thread-id> <hash>", description: "Remove a CAS entry" },
  gc: { handler: dispatchGc, args: "", description: "Garbage-collect unreferenced CAS entries" },
};

const INIT_SUBCOMMAND_TABLE: Record<string, CommandEntry> = {
  workspace: {
    handler: dispatchInitWorkspace,
    args: "<name>",
    description: "Initialize a new workflow workspace",
  },
  template: {
    handler: dispatchInitTemplate,
    args: "<name>",
    description: "Initialize a new workflow template",
  },
};

// ── Command registry ───────────────────────────────────────────────────

export function getCommandRegistry(): ReadonlyArray<CommandGroup> {
  return [
    {
      name: "workflow",
      commands: Object.entries(WORKFLOW_SUBCOMMAND_TABLE).map(([name, e]) => ({
        name,
        args: e.args,
        description: e.description,
      })),
    },
    {
      name: "thread",
      commands: Object.entries(THREAD_SUBCOMMAND_TABLE).map(([name, e]) => ({
        name,
        args: e.args,
        description: e.description,
      })),
    },
    {
      name: "cas",
      commands: Object.entries(CAS_SUBCOMMAND_TABLE).map(([name, e]) => ({
        name,
        args: e.args,
        description: e.description,
      })),
    },
    {
      name: "init",
      commands: Object.entries(INIT_SUBCOMMAND_TABLE).map(([name, e]) => ({
        name,
        args: e.args,
        description: e.description,
      })),
    },
  ];
}

// ── Auto-generated CLI usage ───────────────────────────────────────────

export function formatCliUsage(): string {
  const groups = getCommandRegistry();
  const lines: string[] = ["Usage:"];
  for (const group of groups) {
    for (const cmd of group.commands) {
      const args = cmd.args ? ` ${cmd.args}` : "";
      lines.push(`  uncaged-workflow ${group.name} ${cmd.name}${args}`);
    }
    lines.push("");
  }
  lines.push("  uncaged-workflow run <name> [...]          (shortcut for thread run)");
  lines.push("  uncaged-workflow live <thread-id> [...]    (shortcut for thread live)");
  lines.push("");
  lines.push("Environment variables:");
  lines.push(
    "  WORKFLOW_STORAGE_ROOT              Override storage directory (default: ~/.uncaged/workflow)",
  );
  lines.push(
    "  UNCAGED_WORKFLOW_STORAGE_ROOT      Internal override (takes priority over WORKFLOW_STORAGE_ROOT)",
  );
  return lines.join("\n");
}

function printDeprecation(oldCmd: string, newCmd: string): void {
  printCliWarn(`⚠ "${oldCmd}" is deprecated, use "${newCmd}" instead`);
}

// ── Group dispatchers ──────────────────────────────────────────────────

function dispatchGroup(
  tableName: string,
  table: Record<string, CommandEntry>,
  storageRoot: string,
  argv: string[],
): Promise<number> | null {
  const sub = argv[0];
  if (sub === undefined) {
    printCliError(`${formatCliUsage()}\n\nerror: unknown ${tableName} subcommand: (none)`);
    return Promise.resolve(1);
  }
  const entry = table[sub];
  if (entry === undefined) {
    return null;
  }
  return entry.handler(storageRoot, argv.slice(1));
}

async function dispatchInit(storageRoot: string, argv: string[]): Promise<number> {
  const sub = argv[0];
  const name = argv[1];
  if (sub === undefined || name === undefined || argv.length > 2) {
    printCliError(`${formatCliUsage()}\n\nerror: init requires workspace|template <name>`);
    return 1;
  }

  const entry = INIT_SUBCOMMAND_TABLE[sub];
  if (entry !== undefined) {
    return entry.handler(storageRoot, argv.slice(1));
  }

  printCliError(`${formatCliUsage()}\n\nerror: unknown init subcommand: ${sub}`);
  return 1;
}

async function dispatchWorkflow(storageRoot: string, argv: string[]): Promise<number> {
  const result = dispatchGroup("workflow", WORKFLOW_SUBCOMMAND_TABLE, storageRoot, argv);
  if (result !== null) {
    return result;
  }
  const sub = argv[0];
  if (sub === "remove") {
    printDeprecation("workflow remove", "workflow rm");
    return dispatchRemove(storageRoot, argv.slice(1));
  }
  printCliError(`${formatCliUsage()}\n\nerror: unknown workflow subcommand: ${sub}`);
  return 1;
}

async function dispatchThread(storageRoot: string, argv: string[]): Promise<number> {
  const result = dispatchGroup("thread", THREAD_SUBCOMMAND_TABLE, storageRoot, argv);
  if (result !== null) {
    return result;
  }
  const sub = argv[0];
  printCliError(`${formatCliUsage()}\n\nerror: unknown thread subcommand: ${sub}`);
  return 1;
}

async function dispatchCas(storageRoot: string, argv: string[]): Promise<number> {
  const result = dispatchGroup("cas", CAS_SUBCOMMAND_TABLE, storageRoot, argv);
  if (result !== null) {
    return result;
  }
  const sub = argv[0];
  printCliError(`${formatCliUsage()}\n\nerror: unknown cas subcommand: ${sub}`);
  return 1;
}

// ── Help ────────────────────────────────────────────────────────────────

async function dispatchHelp(_storageRoot: string, argv: string[]): Promise<number> {
  if (argv.includes("--skill")) {
    printCliLine(formatSkillDoc());
  } else {
    printCliLine(formatCliUsage());
  }
  return 0;
}

// ── Top-level command table (Phase 3) ──────────────────────────────────

const COMMAND_TABLE: Record<string, DispatchFn> = {
  // Grouped commands (primary)
  workflow: dispatchWorkflow,
  thread: dispatchThread,
  cas: dispatchCas,
  init: dispatchInit,
  help: dispatchHelp,

  // Top-level shortcuts (no deprecation)
  run: dispatchRun,
  live: dispatchLive,
};

// Deprecated flat commands that delegate to grouped commands
const DEPRECATED_ALIASES: Record<string, { newCmd: string; handler: DispatchFn }> = {
  add: { newCmd: "workflow add", handler: dispatchAdd },
  list: { newCmd: "workflow list", handler: dispatchList },
  show: { newCmd: "workflow show", handler: dispatchShow },
  remove: { newCmd: "workflow rm", handler: dispatchRemove },
  ps: { newCmd: "thread ps", handler: dispatchPs },
  kill: { newCmd: "thread kill", handler: dispatchKill },
  pause: { newCmd: "thread pause", handler: dispatchPause },
  resume: { newCmd: "thread resume", handler: dispatchResume },
  threads: { newCmd: "thread list", handler: dispatchThreadList },
  fork: { newCmd: "thread fork", handler: dispatchFork },
  gc: { newCmd: "cas gc", handler: dispatchGc },
  history: { newCmd: "workflow history", handler: dispatchHistory },
  rollback: { newCmd: "workflow rollback", handler: dispatchRollback },
};

export async function runCli(storageRoot: string, argv: string[]): Promise<number> {
  if (argv.length === 0) {
    printCliError(formatCliUsage());
    return 1;
  }
  const command = argv[0];
  if (command === undefined) {
    printCliError(formatCliUsage());
    return 1;
  }
  const rest = argv.slice(1);

  const dispatch = COMMAND_TABLE[command];
  if (dispatch !== undefined) {
    return dispatch(storageRoot, rest);
  }

  const deprecated = DEPRECATED_ALIASES[command];
  if (deprecated !== undefined) {
    printDeprecation(command, deprecated.newCmd);
    return deprecated.handler(storageRoot, rest);
  }

  printCliError(`${formatCliUsage()}\n\nerror: unknown command ${command}`);
  return 1;
}
