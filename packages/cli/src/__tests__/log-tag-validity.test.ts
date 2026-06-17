import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Static regression guard for log tags (#426).
 *
 * Every `log()` call site uses a hand-written 8-char Crockford Base32 tag.
 * Crockford Base32 excludes I, L, O, U to avoid visual ambiguity, and
 * `assertValidLogTag()` (util/process-logger/log-tag.ts) throws at runtime
 * when a tag contains an illegal character.
 *
 * The bug: `PL_FRONTMATTER_FAIL = "F4FA1L7Z"` (a leet spelling of
 * "FRONTMATTER FAIL") smuggled an `L` into the tag. It only fires on the
 * frontmatter-extraction-failure path, so it stayed dormant until a planner
 * step failed extraction — then the failure logger itself crashed the process,
 * masking the real error.
 *
 * This test scans the source of the cli + broker packages and asserts that
 * EVERY literal tag — whether written inline as `log("XXXXXXXX", ...)` or as a
 * `const PL_* = "XXXXXXXX"` constant — is a valid Crockford Base32 tag. A new
 * illegal tag, in any file, fails here at build time instead of at runtime.
 */

// Crockford Base32 alphabet — no I, L, O, U (mirrors util/src/base32.ts).
const CROCKFORD_BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TAG_CHAR_SET = new Set(CROCKFORD_BASE32_ALPHABET.split(""));
const TAG_LENGTH = 8;

function isValidLogTag(tag: string): boolean {
  if (tag.length !== TAG_LENGTH) {
    return false;
  }
  for (const ch of tag) {
    if (!TAG_CHAR_SET.has(ch.toUpperCase())) {
      return false;
    }
  }
  return true;
}

// Roots scanned for log-tag literals, relative to this test file.
const SCAN_ROOTS = [
  join(__dirname, ".."), // packages/cli/src
  join(__dirname, "..", "..", "..", "broker", "src"), // packages/broker/src
];

async function collectTsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (name === "node_modules" || name === "dist") {
      continue;
    }
    const full = join(dir, name);
    const info = await stat(full);
    if (info.isDirectory()) {
      out.push(...(await collectTsFiles(full)));
    } else if (info.isFile() && name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

type TagOccurrence = {
  tag: string;
  file: string;
  context: string;
};

// Matches `log("XXXXXXXX"` call sites and `... = "XXXXXXXX"` tag constants.
// The capturing group grabs an 8-char alphanumeric literal; isValidLogTag then
// decides legality. We intentionally over-collect (any 8-char string assigned
// to a PL_/TAG const or passed as log()'s first arg) and validate each.
const LOG_CALL_RE = /\blog\(\s*"([0-9A-Za-z]{8})"/g;
const TAG_CONST_RE = /\bconst\s+(?:PL_[A-Z0-9_]+|[A-Z0-9_]*TAG[A-Z0-9_]*)\s*=\s*"([0-9A-Za-z]{8})"/g;

async function collectTagOccurrences(): Promise<TagOccurrence[]> {
  const occurrences: TagOccurrence[] = [];
  for (const root of SCAN_ROOTS) {
    const files = await collectTsFiles(root);
    for (const file of files) {
      const content = await readFile(file, "utf8");
      for (const re of [LOG_CALL_RE, TAG_CONST_RE]) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null = re.exec(content);
        while (m !== null) {
          occurrences.push({ tag: m[1], file, context: m[0] });
          m = re.exec(content);
        }
      }
    }
  }
  return occurrences;
}

describe("log tag validity (#426 regression guard)", () => {
  test("collects at least the known PL_ tag constants", async () => {
    const occurrences = await collectTagOccurrences();
    // Sanity: the scan must actually find tags, otherwise the regex/paths broke
    // and the guard below would pass vacuously.
    expect(occurrences.length).toBeGreaterThanOrEqual(10);
  });

  test("every log tag literal in cli + broker is valid Crockford Base32", async () => {
    const occurrences = await collectTagOccurrences();
    const invalid = occurrences.filter((o) => !isValidLogTag(o.tag));
    const report = invalid
      .map((o) => `  ${o.tag}  (${o.context})  in ${o.file}`)
      .join("\n");
    expect(invalid, `Illegal Crockford Base32 log tags found:\n${report}`).toEqual([]);
  });

  test("the specific F4FA1L7Z bug (#426) stays fixed", async () => {
    const occurrences = await collectTagOccurrences();
    const offenders = occurrences.filter((o) => o.tag === "F4FA1L7Z");
    expect(offenders).toEqual([]);
  });
});
