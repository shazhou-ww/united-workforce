import { describe, expect, test } from "bun:test";
import { hashWorkflowBundleBytes } from "../src/cas/hash.js";
import { decodeCrockfordToUint64 } from "../src/util/base32.js";

describe("hashWorkflowBundleBytes", () => {
  test("matches XXH64 reference for empty input", () => {
    const encoder = new TextEncoder();
    const digest = hashWorkflowBundleBytes(encoder.encode(""));
    const decoded = decodeCrockfordToUint64(digest);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.value).toBe(0xef46_db37_51d8_e999n);
    }
  });

  test("stable for identical content", () => {
    const encoder = new TextEncoder();
    const data = encoder.encode(
      `export const descriptor = { description: "x", roles: {} };
export const run = async function* (input) { return { returnCode: 0, summary: input.prompt }; }
`,
    );
    expect(hashWorkflowBundleBytes(data)).toBe(hashWorkflowBundleBytes(data));
  });
});
