import type { CommandEntry, DispatchFn } from "./cli-command-types.js";
import { printCliError, printCliLine, printCliWarn } from "./cli-output.js";
import { getCommandRegistry } from "./cli-registry.js";
import { formatCliUsage as formatCliUsageWithGroups } from "./cli-usage.js";
import { createCasDispatcher, dispatchGc } from "./commands/cas/dispatch.js";
import { createInitDispatcher } from "./commands/init/dispatch.js";
import {
  createThreadDispatcher,
  dispatchFork,
  dispatchKill,
  dispatchLive,
  dispatchPause,
  dispatchPs,
  dispatchResume,
  dispatchRun,
  dispatchThreadList,
} from "./commands/thread/dispatch.js";
import {
  createWorkflowDispatcher,
  dispatchAdd,
  dispatchHistory,
  dispatchList,
  dispatchRemove,
  dispatchRollback,
  dispatchShow,
} from "./commands/workflow/dispatch.js";
import { formatSkillIndex, formatSkillTopic, getSkillTopics } from "./skill.js";

export type { CommandEntry, CommandGroup, DispatchFn } from "./cli-command-types.js";
export { getCommandRegistry } from "./cli-registry.js";

function dispatchGroup(
  tableName: string,
  table: Record<string, CommandEntry>,
  storageRoot: string,
  argv: string[],
): Promise<number> | null {
  const sub = argv[0];
  if (sub === undefined || sub === "--help" || sub === "-h") {
    const entries = Object.entries(table);
    const lines = [`${tableName} subcommands:\n`];
    for (const [name, e] of entries) {
      const args = e.args ? ` ${e.args}` : "";
      lines.push(`  uncaged-workflow ${tableName} ${name}${args}`);
      lines.push(`      ${e.description}\n`);
    }
    printCliLine(lines.join("\n"));
    return Promise.resolve(sub === undefined ? 1 : 0);
  }
  const entry = table[sub];
  if (entry === undefined) {
    return null;
  }
  return entry.handler(storageRoot, argv.slice(1));
}

function printDeprecation(oldCmd: string, newCmd: string): void {
  printCliWarn(`⚠ "${oldCmd}" is deprecated, use "${newCmd}" instead`);
}

export function formatCliUsage(): string {
  return formatCliUsageWithGroups(getCommandRegistry(), getSkillTopics());
}

const dispatchWorkflow = createWorkflowDispatcher({ dispatchGroup, printDeprecation });
const dispatchThread = createThreadDispatcher({ dispatchGroup });
const dispatchCas = createCasDispatcher({ dispatchGroup });
const dispatchInit = createInitDispatcher({ dispatchGroup });

async function showSkillDocOrIndex(topic: string | undefined): Promise<number> {
  if (topic === undefined) {
    printCliLine(formatSkillIndex());
    return 0;
  }
  const doc = formatSkillTopic(topic);
  if (doc === null) {
    printCliError(`unknown skill topic: ${topic}\n\n${formatSkillIndex()}`);
    return 1;
  }
  printCliLine(doc);
  return 0;
}

async function dispatchSkill(_storageRoot: string, argv: string[]): Promise<number> {
  return showSkillDocOrIndex(argv[0]);
}

async function dispatchHelp(_storageRoot: string, argv: string[]): Promise<number> {
  const skillIdx = argv.indexOf("--skill");
  if (skillIdx !== -1) {
    return showSkillDocOrIndex(argv[skillIdx + 1]);
  }
  printCliLine(formatCliUsage());
  return 0;
}

const COMMAND_TABLE: Record<string, DispatchFn> = {
  workflow: dispatchWorkflow,
  thread: dispatchThread,
  cas: dispatchCas,
  init: dispatchInit,
  help: dispatchHelp,
  skill: dispatchSkill,
  run: dispatchRun,
  live: dispatchLive,
};

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
    printCliLine(formatCliUsage());
    return 1;
  }
  const command = argv[0];
  if (command === undefined) {
    printCliLine(formatCliUsage());
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
