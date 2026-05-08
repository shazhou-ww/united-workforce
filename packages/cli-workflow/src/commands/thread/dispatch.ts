import type { CommandEntry } from "../../cli-command-types.js";
import { printCliError, printCliLine } from "../../cli-output.js";
import { formatCliUsage, USAGE_SKILL_TOPIC_ROWS } from "../../cli-usage.js";
import { getCommandGroupsForUsage } from "../../cli-usage-context.js";
import { parseLiveArgv } from "../../live-argv.js";
import { parseRunArgv } from "../../run-argv.js";
import { cmdKill, cmdPause, cmdResume } from "./control.js";
import { cmdFork } from "./fork.js";
import { parseForkArgv } from "./fork-argv.js";
import { cmdThreads } from "./list.js";
import { cmdLive } from "./live.js";
import { cmdPs } from "./ps.js";
import { cmdThreadRemove } from "./rm.js";
import { cmdRun } from "./run.js";
import { cmdThreadShow } from "./show.js";
import type { ThreadDispatchDeps } from "./types.js";

function usageText(): string {
  return formatCliUsage(getCommandGroupsForUsage(), USAGE_SKILL_TOPIC_ROWS);
}

export async function dispatchRun(storageRoot: string, argv: string[]): Promise<number> {
  const parsed = parseRunArgv(argv);
  if (!parsed.ok) {
    printCliError(`${usageText()}\n\nerror: ${parsed.error}`);
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

export async function dispatchPs(storageRoot: string, argv: string[]): Promise<number> {
  if (argv.length > 0) {
    printCliError(`${usageText()}\n\nerror: ps takes no arguments`);
    return 1;
  }
  for (const line of await cmdPs(storageRoot)) {
    printCliLine(line);
  }
  return 0;
}

export async function dispatchKill(storageRoot: string, argv: string[]): Promise<number> {
  const threadId = argv[0];
  if (threadId === undefined || argv.length > 1) {
    printCliError(`${usageText()}\n\nerror: kill requires <thread-id>`);
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

export async function dispatchLive(storageRoot: string, argv: string[]): Promise<number> {
  const parsed = parseLiveArgv(argv);
  if (!parsed.ok) {
    printCliError(`${usageText()}\n\nerror: ${parsed.error}`);
    return 1;
  }
  return cmdLive(storageRoot, parsed.value);
}

export async function dispatchPause(storageRoot: string, argv: string[]): Promise<number> {
  const threadId = argv[0];
  if (threadId === undefined || argv.length > 1) {
    printCliError(`${usageText()}\n\nerror: pause requires <thread-id>`);
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

export async function dispatchResume(storageRoot: string, argv: string[]): Promise<number> {
  const threadId = argv[0];
  if (threadId === undefined || argv.length > 1) {
    printCliError(`${usageText()}\n\nerror: resume requires <thread-id>`);
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

export async function dispatchThreadList(storageRoot: string, argv: string[]): Promise<number> {
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

export async function dispatchThreadShow(storageRoot: string, argv: string[]): Promise<number> {
  const id = argv[0];
  if (id === undefined || argv.length > 1) {
    printCliError(`${usageText()}\n\nerror: thread show requires <id>`);
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

export async function dispatchThreadRm(storageRoot: string, argv: string[]): Promise<number> {
  const id = argv[0];
  if (id === undefined || argv.length > 1) {
    printCliError(`${usageText()}\n\nerror: thread rm requires <id>`);
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

export async function dispatchFork(storageRoot: string, argv: string[]): Promise<number> {
  const parsed = parseForkArgv(argv);
  if (!parsed.ok) {
    printCliError(`${usageText()}\n\nerror: ${parsed.error}`);
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

export const THREAD_SUBCOMMAND_TABLE: Record<string, CommandEntry> = {
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
    args: "<thread-id> | --latest [--debug] [--role <name>]",
    description: "Attach to a thread and stream output live",
  },
  pause: { handler: dispatchPause, args: "<thread-id>", description: "Pause a running thread" },
  resume: { handler: dispatchResume, args: "<thread-id>", description: "Resume a paused thread" },
};

export function createThreadDispatcher(deps: ThreadDispatchDeps) {
  const { dispatchGroup } = deps;
  return async function dispatchThread(storageRoot: string, argv: string[]): Promise<number> {
    const result = dispatchGroup("thread", THREAD_SUBCOMMAND_TABLE, storageRoot, argv);
    if (result !== null) {
      return result;
    }
    const sub = argv[0];
    printCliError(`${usageText()}\n\nerror: unknown thread subcommand: ${sub}`);
    return 1;
  };
}
