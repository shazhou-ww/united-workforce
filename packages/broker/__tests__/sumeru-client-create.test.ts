/**
 * Tests for `createSumeruClient` — host normalisation, no I/O at construction,
 * and the shape of the returned object.
 */

import { describe, expect, test } from "vitest";

import { createSumeruClient } from "../src/sumeru-client/index.js";

describe("createSumeruClient", () => {
  test("returns an object with createSession + sendMessage methods", () => {
    const client = createSumeruClient("http://127.0.0.1:7900");
    expect(typeof client.createSession).toBe("function");
    expect(typeof client.sendMessage).toBe("function");
  });

  test("returned object is frozen", () => {
    const client = createSumeruClient("http://127.0.0.1:7900");
    expect(Object.isFrozen(client)).toBe(true);
  });

  test("does not perform I/O at construction time (no fetch invoked)", () => {
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = () => {
      calls += 1;
      return Promise.reject(new Error("fetch should not be called"));
    };
    try {
      createSumeruClient("http://127.0.0.1:7900");
      createSumeruClient("http://localhost:7900/");
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls).toBe(0);
  });

  test("constructs without throwing for valid host strings (with or without trailing slash)", () => {
    expect(() => createSumeruClient("http://127.0.0.1:7900")).not.toThrow();
    expect(() => createSumeruClient("http://127.0.0.1:7900/")).not.toThrow();
    expect(() => createSumeruClient("http://127.0.0.1:7900///")).not.toThrow();
  });
});
