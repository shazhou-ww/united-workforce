import type { ExtractFn } from "@uncaged/workflow-runtime";

export type CursorAgentConfig = {
  model: string | null;
  timeout: number;
  extract: ExtractFn;
};
