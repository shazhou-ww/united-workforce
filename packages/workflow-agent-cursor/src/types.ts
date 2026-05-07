import type { ExtractFn } from "@uncaged/workflow";

export type CursorAgentConfig = {
  model: string | null;
  timeout: number;
  extract: ExtractFn;
};
