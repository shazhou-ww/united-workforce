/** Parsed non-interactive `setup` CLI arguments (all fields required for agent mode). */
export type SetupCliArgs = {
  provider: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  initWorkspaceName: string | null;
};

export type PresetProvider = {
  name: string;
  label: string;
  baseUrl: string;
};

export type CmdSetupSuccess = {
  registryPath: string;
  provider: string;
  defaultModel: string;
  maxDepth: number;
  supervisorInterval: number;
  initWorkspaceRootPath: string | null;
};
