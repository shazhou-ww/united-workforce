import type { CommandEntry } from "../../cli-command-types.js";
import { printCliError, printCliLine } from "../../cli-output.js";
import { formatCliUsage, USAGE_SKILL_TOPIC_ROWS } from "../../cli-usage.js";
import { getCommandGroupsForUsage } from "../../cli-usage-context.js";
import { cmdGc } from "./gc.js";
import { cmdCasGet } from "./get.js";
import { cmdCasList } from "./list.js";
import { cmdCasPut } from "./put.js";
import { cmdCasRm } from "./rm.js";
import type { CasDispatchDeps } from "./types.js";

function usageText(): string {
  return formatCliUsage(getCommandGroupsForUsage(), USAGE_SKILL_TOPIC_ROWS);
}

export async function dispatchGc(storageRoot: string, argv: string[]): Promise<number> {
  if (argv.length > 0) {
    printCliError(`${usageText()}\n\nerror: gc takes no arguments`);
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

export async function dispatchCasGet(storageRoot: string, rest: string[]): Promise<number> {
  const hash = rest[0];
  if (hash === undefined || rest.length > 1) {
    printCliError(`${usageText()}\n\nerror: cas get requires <hash>`);
    return 1;
  }
  const result = await cmdCasGet(storageRoot, hash);
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }
  printCliLine(result.value);
  return 0;
}

export async function dispatchCasPut(storageRoot: string, rest: string[]): Promise<number> {
  const content = rest[0];
  if (content === undefined || rest.length > 1) {
    printCliError(`${usageText()}\n\nerror: cas put requires <content>`);
    return 1;
  }
  const result = await cmdCasPut(storageRoot, content);
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }
  printCliLine(result.value);
  return 0;
}

export async function dispatchCasList(storageRoot: string, rest: string[]): Promise<number> {
  if (rest.length > 0) {
    printCliError(`${usageText()}\n\nerror: cas list takes no arguments`);
    return 1;
  }
  const result = await cmdCasList(storageRoot);
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }
  for (const hash of result.value) {
    printCliLine(hash);
  }
  return 0;
}

export async function dispatchCasRm(storageRoot: string, rest: string[]): Promise<number> {
  const hash = rest[0];
  if (hash === undefined || rest.length > 1) {
    printCliError(`${usageText()}\n\nerror: cas rm requires <hash>`);
    return 1;
  }
  const result = await cmdCasRm(storageRoot, hash);
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }
  printCliLine(`removed cas entry ${hash}`);
  return 0;
}

export const CAS_SUBCOMMAND_TABLE: Record<string, CommandEntry> = {
  get: {
    handler: dispatchCasGet,
    args: "<hash>",
    description: "Retrieve content by hash from CAS",
  },
  put: {
    handler: dispatchCasPut,
    args: "<content>",
    description: "Store content in CAS, prints hash",
  },
  list: {
    handler: dispatchCasList,
    args: "",
    description: "List all hashes in CAS",
  },
  rm: { handler: dispatchCasRm, args: "<hash>", description: "Remove a CAS entry by hash" },
  gc: { handler: dispatchGc, args: "", description: "Garbage-collect unreferenced CAS entries" },
};

export function createCasDispatcher(deps: CasDispatchDeps) {
  const { dispatchGroup } = deps;
  return async function dispatchCas(storageRoot: string, argv: string[]): Promise<number> {
    const result = dispatchGroup("cas", CAS_SUBCOMMAND_TABLE, storageRoot, argv);
    if (result !== null) {
      return result;
    }
    const sub = argv[0];
    printCliError(`${usageText()}\n\nerror: unknown cas subcommand: ${sub}`);
    return 1;
  };
}
