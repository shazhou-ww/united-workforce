export type { Result } from "@uncaged/workflow-protocol";

export type LoggerSink = { kind: "stderr" } | { kind: "file"; path: string };

export type CreateLoggerOptions = {
  sink: LoggerSink;
};

export type LogFn = (tag: string, content: string) => void;
