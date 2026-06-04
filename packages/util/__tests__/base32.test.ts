import { describe, expect, it } from "vitest";
import {
  CROCKFORD_BASE32_ALPHABET,
  decodeCrockfordBase32Bits,
  decodeCrockfordToUint64,
  encodeCrockfordBase32Bits,
  encodeUint64AsCrockford,
} from "../src/base32.js";

describe("CROCKFORD_BASE32_ALPHABET", () => {
  it("has exactly 32 characters", () => {
    expect(CROCKFORD_BASE32_ALPHABET).toHaveLength(32);
  });

  it("excludes I, L, O, U", () => {
    expect(CROCKFORD_BASE32_ALPHABET).not.toContain("I");
    expect(CROCKFORD_BASE32_ALPHABET).not.toContain("L");
    expect(CROCKFORD_BASE32_ALPHABET).not.toContain("O");
    expect(CROCKFORD_BASE32_ALPHABET).not.toContain("U");
  });
});

describe("encodeCrockfordBase32Bits / decodeCrockfordBase32Bits", () => {
  it("roundtrips zero with bitLength=5", () => {
    const encoded = encodeCrockfordBase32Bits(0n, 5);
    expect(encoded).toBe("0");
    const decoded = decodeCrockfordBase32Bits(encoded, 5);
    expect(decoded).toEqual({ ok: true, value: 0n });
  });

  it("roundtrips value 31 with bitLength=5", () => {
    const encoded = encodeCrockfordBase32Bits(31n, 5);
    expect(encoded).toBe("Z");
    const decoded = decodeCrockfordBase32Bits(encoded, 5);
    expect(decoded).toEqual({ ok: true, value: 31n });
  });

  it("roundtrips with bitLength=10", () => {
    const encoded = encodeCrockfordBase32Bits(1023n, 10);
    expect(encoded).toBe("ZZ");
    const decoded = decodeCrockfordBase32Bits(encoded, 10);
    expect(decoded).toEqual({ ok: true, value: 1023n });
  });

  it("roundtrips with non-multiple-of-5 bitLength", () => {
    const value = 255n; // 8 bits
    const encoded = encodeCrockfordBase32Bits(value, 8);
    expect(encoded).toHaveLength(2); // 8 bits -> 10 bits padded -> 2 chars
    const decoded = decodeCrockfordBase32Bits(encoded, 8);
    expect(decoded).toEqual({ ok: true, value });
  });

  it("roundtrips large value", () => {
    const value = (1n << 64n) - 1n;
    const encoded = encodeCrockfordBase32Bits(value, 64);
    const decoded = decodeCrockfordBase32Bits(encoded, 64);
    expect(decoded).toEqual({ ok: true, value });
  });

  it("throws on bitLength <= 0", () => {
    expect(() => encodeCrockfordBase32Bits(0n, 0)).toThrow("bitLength must be positive");
    expect(() => encodeCrockfordBase32Bits(0n, -1)).toThrow("bitLength must be positive");
  });

  it("returns error on decode with bitLength <= 0", () => {
    const result = decodeCrockfordBase32Bits("0", 0);
    expect(result.ok).toBe(false);
  });

  it("returns error on invalid character", () => {
    const result = decodeCrockfordBase32Bits("U", 5);
    expect(result.ok).toBe(false);
  });

  it("returns error on wrong encoded length", () => {
    const result = decodeCrockfordBase32Bits("00", 5);
    expect(result.ok).toBe(false);
  });

  it("handles lowercase input on decode", () => {
    const encoded = encodeCrockfordBase32Bits(10n, 5);
    const decoded = decodeCrockfordBase32Bits(encoded.toLowerCase(), 5);
    expect(decoded).toEqual({ ok: true, value: 10n });
  });
});

describe("encodeUint64AsCrockford / decodeCrockfordToUint64", () => {
  it("encodes to 13 characters", () => {
    expect(encodeUint64AsCrockford(0n)).toHaveLength(13);
    expect(encodeUint64AsCrockford(1n)).toHaveLength(13);
  });

  it("roundtrips 0n", () => {
    const encoded = encodeUint64AsCrockford(0n);
    expect(encoded).toBe("0000000000000");
    const decoded = decodeCrockfordToUint64(encoded);
    expect(decoded).toEqual({ ok: true, value: 0n });
  });

  it("roundtrips max uint64", () => {
    const max = (1n << 64n) - 1n;
    const encoded = encodeUint64AsCrockford(max);
    const decoded = decodeCrockfordToUint64(encoded);
    expect(decoded).toEqual({ ok: true, value: max });
  });

  it("roundtrips arbitrary value", () => {
    const value = 0xdead_beef_cafe_baben;
    const encoded = encodeUint64AsCrockford(value);
    const decoded = decodeCrockfordToUint64(encoded);
    expect(decoded).toEqual({ ok: true, value });
  });

  it("masks values beyond 64 bits", () => {
    const over = (1n << 64n) + 42n;
    const encoded = encodeUint64AsCrockford(over);
    const decoded = decodeCrockfordToUint64(encoded);
    expect(decoded).toEqual({ ok: true, value: 42n });
  });

  it("returns error for invalid input", () => {
    const result = decodeCrockfordToUint64("!!!");
    expect(result.ok).toBe(false);
  });

  it("returns error for wrong length", () => {
    const result = decodeCrockfordToUint64("000");
    expect(result.ok).toBe(false);
  });
});
