import type { DispatchGroupFn } from "../../cli-command-types.js";

export type LiveRoleRow = {
  role: string;
  content: string;
  meta: Record<string, unknown>;
  timestamp: number;
};

export type ParsedForkArgv = {
  threadId: string;
  fromRole: string | null;
};

export type ThreadDispatchDeps = {
  dispatchGroup: DispatchGroupFn;
};
