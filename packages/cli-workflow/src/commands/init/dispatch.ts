import type { CommandEntry } from "../../cli-command-types.js";
import { printCliError, printCliLine } from "../../cli-output.js";
import { formatCliUsage, USAGE_SKILL_TOPIC_ROWS } from "../../cli-usage.js";
import { getCommandGroupsForUsage } from "../../cli-usage-context.js";
import { cmdInitTemplate } from "./template.js";
import type { InitDispatchDeps } from "./types.js";
import { cmdInitWorkspace } from "./workspace.js";

function usageText(): string {
  return formatCliUsage(getCommandGroupsForUsage(), USAGE_SKILL_TOPIC_ROWS);
}

export async function dispatchInitWorkspace(_storageRoot: string, argv: string[]): Promise<number> {
  const name = argv[0];
  if (name === undefined || argv.length > 1) {
    printCliError(`${usageText()}\n\nerror: init workspace requires <name>`);
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

export async function dispatchInitTemplate(_storageRoot: string, argv: string[]): Promise<number> {
  const name = argv[0];
  if (name === undefined || argv.length > 1) {
    printCliError(`${usageText()}\n\nerror: init template requires <name>`);
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

export const INIT_SUBCOMMAND_TABLE: Record<string, CommandEntry> = {
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

export function createInitDispatcher(deps: InitDispatchDeps) {
  const { dispatchGroup } = deps;
  return async function dispatchInit(storageRoot: string, argv: string[]): Promise<number> {
    const result = dispatchGroup("init", INIT_SUBCOMMAND_TABLE, storageRoot, argv);
    if (result !== null) {
      return result;
    }
    const sub = argv[0];
    printCliError(`${usageText()}\n\nerror: unknown init subcommand: ${sub}`);
    return 1;
  };
}
