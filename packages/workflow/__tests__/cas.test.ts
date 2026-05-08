import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCasStore } from "../src/cas/cas.js";
import { hashString } from "../src/cas/hash.js";
import { createContentMerkleNode, serializeMerkleNode } from "../src/cas/merkle.js";

function casStoredForm(raw: string): string {
  return serializeMerkleNode(createContentMerkleNode(raw));
}

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
    const raw = "hello world";
    const stored = casStoredForm(raw);
    const h1 = await cas.put(raw);
    const h2 = await cas.put(raw);
    expect(h1).toBe(h2);
    expect(h1).toBe(hashString(stored));
    expect(h1).toHaveLength(13);
  });

  test("put returns hash matching hashString of merkle-stored form", async () => {
    const cas = createCasStore(casDir);
    const content = "some content to store";
    const stored = casStoredForm(content);
    const h = await cas.put(content);
    expect(h).toBe(hashString(stored));
  });

  test("get returns merkle-serialized blob for raw puts", async () => {
    const cas = createCasStore(casDir);
    const content = "line1\nline2\nline3";
    const stored = casStoredForm(content);
    const h = await cas.put(content);
    const retrieved = await cas.get(h);
    expect(retrieved).toBe(stored);
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
    const raw = "idempotent";
    const stored = casStoredForm(raw);
    const h1 = await cas.put(raw);
    const h2 = await cas.put(raw);
    expect(h1).toBe(h2);
    const content = await cas.get(h1);
    expect(content).toBe(stored);
  });

  test("different content produces different hashes", async () => {
    const cas = createCasStore(casDir);
    const h1 = await cas.put("alpha");
    const h2 = await cas.put("beta");
    expect(h1).not.toBe(h2);
  });
});
