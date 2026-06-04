import { describe, expect, it } from "vitest";
import { assertValidLogTag } from "../src/process-logger/log-tag.js";

describe("assertValidLogTag", () => {
  it("accepts valid 8-char Crockford Base32 tags", () => {
    expect(() => assertValidLogTag("0123ABCD")).not.toThrow();
    expect(() => assertValidLogTag("VWXYZ789")).not.toThrow();
    expect(() => assertValidLogTag("00000000")).not.toThrow();
    expect(() => assertValidLogTag("ZZZZZZZZ")).not.toThrow();
  });

  it("accepts lowercase (converted via toUpperCase)", () => {
    expect(() => assertValidLogTag("abcdefgh")).not.toThrow();
    expect(() => assertValidLogTag("0a1b2c3d")).not.toThrow();
  });

  it("throws on too short", () => {
    expect(() => assertValidLogTag("1234567")).toThrow();
    expect(() => assertValidLogTag("")).toThrow();
  });

  it("throws on too long", () => {
    expect(() => assertValidLogTag("123456789")).toThrow();
  });

  it("throws on invalid chars I, L, O, U", () => {
    expect(() => assertValidLogTag("IIIIIIII")).toThrow();
    expect(() => assertValidLogTag("LLLLLLLL")).toThrow();
    expect(() => assertValidLogTag("OOOOOOOO")).toThrow();
    expect(() => assertValidLogTag("UUUUUUUU")).toThrow();
  });

  it("throws on special characters", () => {
    expect(() => assertValidLogTag("1234567!")).toThrow();
    expect(() => assertValidLogTag("ABCD-EFG")).toThrow();
    expect(() => assertValidLogTag("ABCD EFG")).toThrow();
  });
});
