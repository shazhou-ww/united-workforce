import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCasStore, createThreadCas } from "../src/cas.js";
import { hashString } from "../src/hash.js";

describe("cas module exports", () => {
  test("createThreadCas is a deprecated alias of createCasStore", () => {
    expect(createThreadCas).toBe(createCasStore);
  });
});

describe("createCasStore", () => {
  let casDir: string;

  beforeEach(async () => {
    casDir = await mkdtemp(join(tmpdir(), "cas-test-"));
  });

  afterEach(async () => {
    await rm(casDir, { recursive: true, force: true });
  });

  test("put returns consistent hash for same content", async () => {
    const cas = createCasStore(casDir);
    const h1 = await cas.put("hello world");
    const h2 = await cas.put("hello world");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(13);
  });

  test("put returns hash matching hashString", async () => {
    const cas = createCasStore(casDir);
    const content = "some content to store";
    const h = await cas.put(content);
    expect(h).toBe(hashString(content));
  });

  test("get returns stored content", async () => {
    const cas = createCasStore(casDir);
    const content = "line1\nline2\nline3";
    const h = await cas.put(content);
    const retrieved = await cas.get(h);
    expect(retrieved).toBe(content);
  });

  test("get returns null for missing hash", async () => {
    const cas = createCasStore(casDir);
    const result = await cas.get("0000000000000");
    expect(result).toBeNull();
  });

  test("delete removes entry", async () => {
    const cas = createCasStore(casDir);
    const h = await cas.put("to be deleted");
    await cas.delete(h);
    const result = await cas.get(h);
    expect(result).toBeNull();
  });

  test("delete on missing hash does not throw", async () => {
    const cas = createCasStore(casDir);
    await cas.delete("0000000000000");
  });

  test("list returns all stored hashes", async () => {
    const cas = createCasStore(casDir);
    const h1 = await cas.put("aaa");
    const h2 = await cas.put("bbb");
    const h3 = await cas.put("ccc");
    const hashes = await cas.list();
    expect(hashes.sort()).toEqual([h1, h2, h3].sort());
  });

  test("list returns empty array when cas dir does not exist", async () => {
    const cas = createCasStore(join(casDir, "nonexistent"));
    const hashes = await cas.list();
    expect(hashes).toEqual([]);
  });

  test("put is idempotent — same content written twice causes no error", async () => {
    const cas = createCasStore(casDir);
    const h1 = await cas.put("idempotent");
    const h2 = await cas.put("idempotent");
    expect(h1).toBe(h2);
    const content = await cas.get(h1);
    expect(content).toBe("idempotent");
  });

  test("different content produces different hashes", async () => {
    const cas = createCasStore(casDir);
    const h1 = await cas.put("alpha");
    const h2 = await cas.put("beta");
    expect(h1).not.toBe(h2);
  });
});
