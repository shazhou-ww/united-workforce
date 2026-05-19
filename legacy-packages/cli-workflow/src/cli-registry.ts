import type { CommandGroup } from "./cli-command-types.js";
import { setCommandGroupsForUsage } from "./cli-usage-context.js";
import { CAS_SUBCOMMAND_TABLE } from "./commands/cas/index.js";
import { INIT_SUBCOMMAND_TABLE } from "./commands/init/index.js";
import { THREAD_SUBCOMMAND_TABLE } from "./commands/thread/index.js";
import { WORKFLOW_SUBCOMMAND_TABLE } from "./commands/workflow/index.js";

const SETUP_USAGE_COMMANDS = [
  {
    name: "",
    args: "[--provider <name>] [--base-url <url>] [--api-key <key>] [--default-model <provider/model>] [--init-workspace <name>]",
    description:
      "Configure workflow.yaml LLM providers and default model (interactive when no flags)",
  },
] as const;

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
    {
      name: "setup",
      commands: [...SETUP_USAGE_COMMANDS],
    },
  ];
}

setCommandGroupsForUsage(getCommandRegistry());
