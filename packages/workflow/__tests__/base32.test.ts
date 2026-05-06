import { describe, expect, test } from "bun:test";

import {
  decodeCrockfordBase32Bits,
  decodeCrockfordToUint64,
  encodeCrockfordBase32Bits,
  encodeUint64AsCrockford,
} from "../src/base32.js";

describe("Crockford Base32", () => {
  test("roundtrip 64-bit hash encoding", () => {
    const value = 0xef46_db37_51d8_e999n;
    const encoded = encodeUint64AsCrockford(value);
    expect(encoded.length).toBe(13);
    const decoded = decodeCrockfordToUint64(encoded);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.value).toBe(value);
    }
  });

  test("roundtrip arbitrary bit widths used by ULID (128-bit)", () => {
    const rand = 0x1234567890abcdef12n & ((1n << 80n) - 1n);
    const payload = (12345n << 80n) | rand;
    const encoded = encodeCrockfordBase32Bits(payload, 128);
    expect(encoded.length).toBe(26);
    const decoded = decodeCrockfordBase32Bits(encoded, 128);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.value).toBe(payload);
    }
  });

  test("reject invalid characters", () => {
    const decoded = decodeCrockfordToUint64("!!!!!!!!!!!!!");
    expect(decoded.ok).toBe(false);
  });
});
