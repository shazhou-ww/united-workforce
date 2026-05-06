import { describe, expect, test } from "bun:test";

import { decodeCrockfordToUint64 } from "../src/base32.js";
import { hashWorkflowBundleBytes } from "../src/hash.js";

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
      "export default async function* run() { return { returnCode: 0, summary: '' }; }\n",
    );
    expect(hashWorkflowBundleBytes(data)).toBe(hashWorkflowBundleBytes(data));
  });
});
