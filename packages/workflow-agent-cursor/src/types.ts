export type CursorAgentConfig = {
  /** Absolute path to the cursor-agent CLI binary. */
  command: string;
  model: string | null;
  timeout: number;
  /**
   * When non-null, use this workspace directory for `cursor-agent` instead of resolving it
   * from the thread via runtime extraction.
   */
  workspace: string | null;
};
