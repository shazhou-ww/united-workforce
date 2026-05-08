import { describe, expect, test } from "bun:test";

import { decodeCrockfordBase32Bits } from "../src/util/base32.js";
import { generateUlid } from "../src/util/ulid.js";

describe("generateUlid", () => {
  test("length and decodable Crockford payload", () => {
    const id = generateUlid(1_714_963_200_000);
    expect(id.length).toBe(26);
    const decoded = decodeCrockfordBase32Bits(id, 128);
    expect(decoded.ok).toBe(true);
  });

  test("embeds 48-bit timestamp at the MSB of the 128-bit payload", () => {
    const ts = 9_999_888_777_666;
    const id = generateUlid(ts);
    const decoded = decodeCrockfordBase32Bits(id, 128);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      const recoveredMs = decoded.value >> 80n;
      expect(Number(recoveredMs)).toBe(ts);
    }
  });

  test("rejects out-of-range timestamps", () => {
    expect(() => generateUlid(-1)).toThrow();
    expect(() => generateUlid(2 ** 48)).toThrow();
  });
});
