import type { DispatchGroupFn } from "../../cli-command-types.js";

export type ParsedAddArgv = {
  name: string;
  filePath: string;
  /** Override path to `.d.ts` when adding a bundle. */
  typesPath: string | null;
};

export type CmdAddSuccess = {
  hash: string;
  warnings: ReadonlyArray<string>;
};

export type WorkflowDispatchDeps = {
  dispatchGroup: DispatchGroupFn;
};
