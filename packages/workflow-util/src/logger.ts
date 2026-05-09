import { appendFileSync } from "node:fs";

import { CROCKFORD_BASE32_ALPHABET } from "./base32.js";
import type { CreateLoggerOptions, LogFn } from "./types.js";

const TAG_LENGTH = 8;

const TAG_CHAR_SET: ReadonlySet<string> = new Set(CROCKFORD_BASE32_ALPHABET.split(""));

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
    if (!TAG_CHAR_SET.has(upper)) {
      throw new Error(`invalid Crockford Base32 character in log tag: ${ch}`);
    }
  }
}

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
