export type HermesAgentConfig = {
  /** Absolute path to the hermes CLI binary. */
  command: string;
  model: string | null;
  timeout: number | null;
};
