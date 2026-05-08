import type { CommandGroup } from "./cli-command-types.js";

let commandGroupsForUsage: ReadonlyArray<CommandGroup> | null = null;

export function setCommandGroupsForUsage(groups: ReadonlyArray<CommandGroup>): void {
  commandGroupsForUsage = groups;
}

export function getCommandGroupsForUsage(): ReadonlyArray<CommandGroup> {
  if (commandGroupsForUsage === null) {
    throw new Error("BUG: command groups for usage not initialized");
  }
  return commandGroupsForUsage;
}
