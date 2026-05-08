import type { CommandEntry } from "../../cli-command-types.js";
import { printCliError, printCliLine, printCliWarn } from "../../cli-output.js";
import { formatCliUsage, USAGE_SKILL_TOPIC_ROWS } from "../../cli-usage.js";
import { getCommandGroupsForUsage } from "../../cli-usage-context.js";
import { cmdAdd, formatAddSuccess } from "./add.js";
import { parseAddArgv } from "./add-argv.js";
import { cmdHistory } from "./history.js";
import { cmdList, formatListLines } from "./list.js";
import { cmdRemove } from "./rm.js";
import { cmdRollback } from "./rollback.js";
import { cmdShow, formatShowYaml } from "./show.js";
import type { WorkflowDispatchDeps } from "./types.js";

function usageText(): string {
  return formatCliUsage(getCommandGroupsForUsage(), USAGE_SKILL_TOPIC_ROWS);
}

export async function dispatchAdd(storageRoot: string, argv: string[]): Promise<number> {
  const parsed = parseAddArgv(argv);
  if (!parsed.ok) {
    printCliError(`${usageText()}\n\nerror: ${parsed.error}`);
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

export async function dispatchList(storageRoot: string, argv: string[]): Promise<number> {
  if (argv.length > 0) {
    printCliError(`${usageText()}\n\nerror: list takes no arguments`);
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

export async function dispatchShow(storageRoot: string, argv: string[]): Promise<number> {
  const name = argv[0];
  if (name === undefined || argv.length > 1) {
    printCliError(`${usageText()}\n\nerror: show requires <name>`);
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

export async function dispatchRemove(storageRoot: string, argv: string[]): Promise<number> {
  const name = argv[0];
  if (name === undefined || argv.length > 1) {
    printCliError(`${usageText()}\n\nerror: remove requires <name>`);
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

export async function dispatchHistory(storageRoot: string, argv: string[]): Promise<number> {
  const name = argv[0];
  if (name === undefined || argv.length > 1) {
    printCliError(`${usageText()}\n\nerror: history requires <name>`);
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

export async function dispatchRollback(storageRoot: string, argv: string[]): Promise<number> {
  const name = argv[0];
  if (name === undefined || argv.length > 2) {
    printCliError(`${usageText()}\n\nerror: rollback requires <name> [hash]`);
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

export const WORKFLOW_SUBCOMMAND_TABLE: Record<string, CommandEntry> = {
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

export function createWorkflowDispatcher(deps: WorkflowDispatchDeps) {
  const { dispatchGroup, printDeprecation } = deps;
  return async function dispatchWorkflow(storageRoot: string, argv: string[]): Promise<number> {
    const result = dispatchGroup("workflow", WORKFLOW_SUBCOMMAND_TABLE, storageRoot, argv);
    if (result !== null) {
      return result;
    }
    const sub = argv[0];
    if (sub === "remove") {
      printDeprecation("workflow remove", "workflow rm");
      return dispatchRemove(storageRoot, argv.slice(1));
    }
    printCliError(`${usageText()}\n\nerror: unknown workflow subcommand: ${sub}`);
    return 1;
  };
}
