import { appendFileSync } from "node:fs";

import { assertValidLogTag } from "./process-logger/log-tag.js";
import type { CreateLoggerOptions, LogFn } from "./types.js";

/** Append one JSONL log record: `{ tag, content, timestamp }` per RFC-001. */
export function createLogger(options: CreateLoggerOptions): LogFn {
  if (options.sink.kind === "stderr") {
    return (tag: string, content: string) => {
      assertValidLogTag(tag);
      const line = `${JSON.stringify({
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
    const line = `${JSON.stringify({
      tag: tag.toUpperCase(),
      content,
      timestamp: Date.now(),
    })}\n`;
    appendFileSync(filePath, line, "utf8");
  };
}
