import { appendFileSync } from "node:fs";

const TAG_LENGTH = 8;

function assertValidLogTag(tag: string): void {
  if (tag.length !== TAG_LENGTH) {
    throw new Error(`log tag must be exactly ${TAG_LENGTH} characters`);
  }
  for (let i = 0; i < tag.length; i++) {
    const ch = tag[i];
    if (ch === undefined) {
      throw new Error("log tag validation failed");
    }
    const upper = ch.toUpperCase();
    if (!/[0-9A-HJKMNP-TV-Z]/.test(upper)) {
      throw new Error(`invalid Crockford Base32 character in log tag: ${ch}`);
    }
  }
}

export type LoggerSink =
  | { kind: "stderr" }
  | { kind: "file"; path: string };

export type CreateLoggerOptions = {
  sink: LoggerSink;
};

export type LogFn = (tag: string, content: string) => void;

/** Append one JSONL log record: `{ tag, content, timestamp }` per RFC-001. */
export function createLogger(options: CreateLoggerOptions): LogFn {
  if (options.sink.kind === "stderr") {
    return (tag: string, content: string) => {
      assertValidLogTag(tag);
      const line =
        `${JSON.stringify({
          tag: tag.toUpperCase(),
          content,
          timestamp: Date.now(),
        })}\n`;
      process.stderr.write(line);
    };
  }

  const filePath = options.sink.path;
  return (tag: string, content: string) => {
    assertValidLogTag(tag);
    const line =
      `${JSON.stringify({
        tag: tag.toUpperCase(),
        content,
        timestamp: Date.now(),
      })}\n`;
    appendFileSync(filePath, line, "utf8");
  };
}
