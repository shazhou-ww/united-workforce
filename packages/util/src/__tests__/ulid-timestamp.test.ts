import { describe, expect, it } from "vitest";
import { extractUlidTimestamp, generateUlid } from "../ulid.js";

describe("extractUlidTimestamp", () => {
  it("should extract correct timestamp from ULID", () => {
    const knownTimestamp = Date.UTC(2026, 4, 20, 0, 0, 0);
    const ulid = generateUlid(knownTimestamp);
    const extracted = extractUlidTimestamp(ulid);
    expect(extracted).toBe(knownTimestamp);
  });

  it("should handle epoch timestamp (timestamp 0)", () => {
    const ulid = generateUlid(0);
    const extracted = extractUlidTimestamp(ulid);
    expect(extracted).toBe(0);
  });

  it("should handle recent timestamps", () => {
    const recentTimestamp = Date.now();
    const ulid = generateUlid(recentTimestamp);
    const extracted = extractUlidTimestamp(ulid);
    expect(extracted).toBe(recentTimestamp);
  });

  it("should handle max 48-bit timestamp", () => {
    const maxTimestamp = 2 ** 48 - 1;
    const ulid = generateUlid(maxTimestamp);
    const extracted = extractUlidTimestamp(ulid);
    expect(extracted).toBe(maxTimestamp);
  });

  it("should return null for invalid ULID length", () => {
    expect(extractUlidTimestamp("")).toBe(null);
    expect(extractUlidTimestamp("TOOSHORT")).toBe(null);
    expect(extractUlidTimestamp("TOOLONGAAAAAAAAAAAAAAAAAA")).toBe(null);
  });

  it("should return null for invalid Crockford Base32 characters", () => {
    expect(extractUlidTimestamp("INVALID!@#$%^&CHARACTERS")).toBe(null);
  });

  it("should extract timestamps from multiple ULIDs correctly", () => {
    const timestamps = [
      Date.UTC(2020, 0, 1, 0, 0, 0),
      Date.UTC(2023, 5, 15, 12, 30, 45),
      Date.UTC(2026, 11, 31, 23, 59, 59),
    ];

    for (const ts of timestamps) {
      const ulid = generateUlid(ts);
      const extracted = extractUlidTimestamp(ulid);
      expect(extracted).toBe(ts);
    }
  });
});
