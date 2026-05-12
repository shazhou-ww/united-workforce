/** Parsed non-interactive `setup` CLI arguments (all fields required for agent mode). */
export type SetupCliArgs = {
  provider: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  initWorkspaceName: string | null;
};
