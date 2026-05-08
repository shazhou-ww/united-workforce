export type { Result } from "@uncaged/workflow-runtime";

export type LoggerSink = { kind: "stderr" } | { kind: "file"; path: string };

export type CreateLoggerOptions = {
  sink: LoggerSink;
};

export type LogFn = (tag: string, content: string) => void;
