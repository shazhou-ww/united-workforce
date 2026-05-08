import type { DispatchGroupFn } from "../../cli-command-types.js";

export type CmdInitTemplateSuccess = {
  templatePath: string;
};

export type CmdInitWorkspaceSuccess = {
  rootPath: string;
};

export type InitDispatchDeps = {
  dispatchGroup: DispatchGroupFn;
};
