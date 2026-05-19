export type DispatchFn = (storageRoot: string, argv: string[]) => Promise<number>;

export type CommandEntry = {
  handler: DispatchFn;
  args: string;
  description: string;
};

export type CommandGroup = {
  name: string;
  commands: ReadonlyArray<{ name: string; args: string; description: string }>;
};

export type DispatchGroupFn = (
  tableName: string,
  table: Record<string, CommandEntry>,
  storageRoot: string,
  argv: string[],
) => Promise<number> | null;
