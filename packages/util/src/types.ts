export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export type LoggerSink = { kind: "stderr" } | { kind: "file"; path: string };

export type CreateLoggerOptions = {
  sink: LoggerSink;
};

export type LogFn = (tag: string, content: string) => void;
