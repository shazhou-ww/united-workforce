import type { CommandEntry, DispatchFn } from "./cli-command-types.js";
import { printCliError, printCliLine } from "./cli-output.js";
import { getCommandRegistry } from "./cli-registry.js";
import { formatCliUsage as formatCliUsageWithGroups } from "./cli-usage.js";
import { createCasDispatcher } from "./commands/cas/index.js";
import { createInitDispatcher } from "./commands/init/index.js";
import { dispatchServe } from "./commands/serve/index.js";
import { createThreadDispatcher, dispatchLive, dispatchRun } from "./commands/thread/index.js";
import { createWorkflowDispatcher } from "./commands/workflow/index.js";
import { formatSkillIndex, formatSkillTopic, getSkillTopics } from "./skill.js";

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

export function formatCliUsage(): string {
  return formatCliUsageWithGroups(getCommandRegistry(), getSkillTopics());
}

const dispatchWorkflow = createWorkflowDispatcher({ dispatchGroup });
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

const COMMAND_TABLE: Record<string, DispatchFn> = {
  workflow: dispatchWorkflow,
  thread: dispatchThread,
  cas: dispatchCas,
  init: dispatchInit,
  skill: dispatchSkill,
  run: dispatchRun,
  live: dispatchLive,
  serve: dispatchServe,
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

  printCliError(`${formatCliUsage()}\n\nerror: unknown command ${command}`);
  return 1;
}
