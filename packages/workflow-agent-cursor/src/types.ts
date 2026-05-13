export type CursorAgentConfig = {
  /** Absolute path to the cursor-agent CLI binary. */
  command: string;
  model: string | null;
  timeout: number;
};
