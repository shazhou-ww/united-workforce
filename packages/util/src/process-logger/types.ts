export type ProcessLoggerContext = {
  thread: string | null;
  workflow: string | null;
};

export type CreateProcessLoggerOptions = {
  storageRoot: string | null;
  context: ProcessLoggerContext;
};

export type ProcessLogFn = (
  tag: string,
  msg: string,
  context: Record<string, string> | null,
) => void;

export type ProcessLogger = {
  pid: string;
  log: ProcessLogFn;
};
