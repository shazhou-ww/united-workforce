import { printCliError, printCliLine, printCliWarn } from "./cli-output.js";
import { cmdAdd, formatAddSuccess, parseAddArgv } from "./cmd-add.js";
import { cmdCasGet, cmdCasList, cmdCasPut, cmdCasRm } from "./cmd-cas.js";
import { cmdFork, parseForkArgv } from "./cmd-fork.js";
import { cmdHistory } from "./cmd-history.js";
import { cmdKill } from "./cmd-kill.js";
import { cmdList, formatListLines } from "./cmd-list.js";
import { cmdPause } from "./cmd-pause.js";
import { cmdPs } from "./cmd-ps.js";
import { cmdRemove } from "./cmd-remove.js";
import { cmdResume } from "./cmd-resume.js";
import { cmdRollback } from "./cmd-rollback.js";
import { cmdRun } from "./cmd-run.js";
import { cmdShow, formatShowYaml } from "./cmd-show.js";
import { cmdThreadRemove, cmdThreadShow } from "./cmd-thread.js";
import { cmdThreads } from "./cmd-threads.js";
import { parseRunArgv } from "./run-argv.js";

function usage(): string {
  return [
    "Usage:",
    "  uncaged-workflow add <name> <file.esm.js> [--types <path>]",
    "  uncaged-workflow list",
    "  uncaged-workflow show <name>",
    "  uncaged-workflow remove <name>",
    "  uncaged-workflow run <name> [--prompt <text>] [--max-rounds N]",
    "  uncaged-workflow ps",
    "  uncaged-workflow kill <thread-id>",
    "  uncaged-workflow history <name>",
    "  uncaged-workflow rollback <name> [hash]",
    "  uncaged-workflow pause <thread-id>",
    "  uncaged-workflow resume <thread-id>",
    "  uncaged-workflow threads [name]",
    "  uncaged-workflow thread <id>",
    "  uncaged-workflow thread rm <id>",
    "  uncaged-workflow fork <thread-id> [--from-role <role>]",
    "  uncaged-workflow cas get <thread-id> <hash>",
    "  uncaged-workflow cas put <thread-id> <content>",
    "  uncaged-workflow cas list <thread-id>",
    "  uncaged-workflow cas rm <thread-id> <hash>",
  ].join("\n");
}

async function dispatchAdd(storageRoot: string, argv: string[]): Promise<number> {
  const parsed = parseAddArgv(argv);
  if (!parsed.ok) {
    printCliError(`${usage()}\n\nerror: ${parsed.error}`);
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
    printCliError(`${usage()}\n\nerror: list takes no arguments`);
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
    printCliError(`${usage()}\n\nerror: show requires <name>`);
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
    printCliError(`${usage()}\n\nerror: remove requires <name>`);
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
    printCliError(`${usage()}\n\nerror: ${parsed.error}`);
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
    printCliError(`${usage()}\n\nerror: ps takes no arguments`);
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
    printCliError(`${usage()}\n\nerror: kill requires <thread-id>`);
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

async function dispatchHistory(storageRoot: string, argv: string[]): Promise<number> {
  const name = argv[0];
  if (name === undefined || argv.length > 1) {
    printCliError(`${usage()}\n\nerror: history requires <name>`);
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
    printCliError(`${usage()}\n\nerror: rollback requires <name> [hash]`);
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
    printCliError(`${usage()}\n\nerror: pause requires <thread-id>`);
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
    printCliError(`${usage()}\n\nerror: resume requires <thread-id>`);
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

async function dispatchThreads(storageRoot: string, argv: string[]): Promise<number> {
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

async function dispatchThread(storageRoot: string, argv: string[]): Promise<number> {
  const id = argv[0];
  if (id === undefined || argv.length > 1) {
    printCliError(`${usage()}\n\nerror: thread requires <id>`);
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
    printCliError(`${usage()}\n\nerror: thread rm requires <id>`);
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

async function dispatchThreadBranch(storageRoot: string, rest: string[]): Promise<number> {
  const sub = rest[0];
  if (sub === "rm") {
    return dispatchThreadRm(storageRoot, rest.slice(1));
  }
  return dispatchThread(storageRoot, rest);
}

async function dispatchFork(storageRoot: string, argv: string[]): Promise<number> {
  const parsed = parseForkArgv(argv);
  if (!parsed.ok) {
    printCliError(`${usage()}\n\nerror: ${parsed.error}`);
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

async function dispatchCasGet(storageRoot: string, rest: string[]): Promise<number> {
  const threadId = rest[0];
  const hash = rest[1];
  if (threadId === undefined || hash === undefined || rest.length > 2) {
    printCliError(`${usage()}\n\nerror: cas get requires <thread-id> <hash>`);
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
    printCliError(`${usage()}\n\nerror: cas put requires <thread-id> <content>`);
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
    printCliError(`${usage()}\n\nerror: cas list requires <thread-id>`);
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
    printCliError(`${usage()}\n\nerror: cas rm requires <thread-id> <hash>`);
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

const CAS_SUBCOMMAND_TABLE: Record<
  string,
  (storageRoot: string, rest: string[]) => Promise<number>
> = {
  get: dispatchCasGet,
  put: dispatchCasPut,
  list: dispatchCasList,
  rm: dispatchCasRm,
};

async function dispatchCas(storageRoot: string, argv: string[]): Promise<number> {
  const sub = argv[0];
  if (sub === undefined) {
    printCliError(`${usage()}\n\nerror: unknown cas subcommand: (none)`);
    return 1;
  }
  const handler = CAS_SUBCOMMAND_TABLE[sub];
  if (handler === undefined) {
    printCliError(`${usage()}\n\nerror: unknown cas subcommand: ${sub}`);
    return 1;
  }
  return handler(storageRoot, argv.slice(1));
}

type DispatchFn = (storageRoot: string, argv: string[]) => Promise<number>;

const COMMAND_TABLE: Record<string, DispatchFn> = {
  add: dispatchAdd,
  list: dispatchList,
  show: dispatchShow,
  remove: dispatchRemove,
  run: dispatchRun,
  ps: dispatchPs,
  kill: dispatchKill,
  history: dispatchHistory,
  rollback: dispatchRollback,
  pause: dispatchPause,
  resume: dispatchResume,
  threads: dispatchThreads,
  thread: dispatchThreadBranch,
  fork: dispatchFork,
  cas: dispatchCas,
};

export async function runCli(storageRoot: string, argv: string[]): Promise<number> {
  if (argv.length === 0) {
    printCliError(usage());
    return 1;
  }
  const command = argv[0];
  if (command === undefined) {
    printCliError(usage());
    return 1;
  }
  const rest = argv.slice(1);
  const dispatch = COMMAND_TABLE[command];
  if (dispatch === undefined) {
    printCliError(`${usage()}\n\nerror: unknown command ${command}`);
    return 1;
  }
  return dispatch(storageRoot, rest);
}
