import { CROCKFORD_BASE32_ALPHABET } from "../base32.js";

const TAG_LENGTH = 8;

const TAG_CHAR_SET: ReadonlySet<string> = new Set(CROCKFORD_BASE32_ALPHABET.split(""));

export function assertValidLogTag(tag: string): void {
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
