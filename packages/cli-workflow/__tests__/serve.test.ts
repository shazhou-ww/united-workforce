import { describe, expect, test } from "bun:test";

import { createContentMerkleNode, serializeMerkleNode } from "@uncaged/workflow";

import { createApp } from "../src/commands/serve/app.js";

function casStoredForm(raw: string): string {
  return serializeMerkleNode(createContentMerkleNode(raw));
}

function buildApp(storageRoot: string) {
  const app = createApp(storageRoot);
  return {
    fetch: (path: string, init?: RequestInit) =>
      app.fetch(new Request(`http://localhost${path}`, init)),
  };
}

describe("serve /healthz", () => {
  test("returns ok", async () => {
    const { fetch } = buildApp("/tmp/uncaged-serve-test-nonexistent");
    const res = await fetch("/healthz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

describe("serve /api/workflows", () => {
  test("returns empty list for missing storage", async () => {
    const { fetch } = buildApp("/tmp/uncaged-serve-test-nonexistent");
    const res = await fetch("/api/workflows");
    // Registry file won't exist, should return error
    expect(res.status).toBe(200);
  });
});

describe("serve /api/threads", () => {
  test("returns empty list for missing storage", async () => {
    const { fetch } = buildApp("/tmp/uncaged-serve-test-nonexistent");
    const res = await fetch("/api/threads");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { threads: unknown[] };
    expect(body.threads).toEqual([]);
  });

  test("returns 404 for missing thread", async () => {
    const { fetch } = buildApp("/tmp/uncaged-serve-test-nonexistent");
    const res = await fetch("/api/threads/nonexistent-id");
    expect(res.status).toBe(404);
  });
});

describe("serve /api/threads/running", () => {
  test("returns empty list for missing storage", async () => {
    const { fetch } = buildApp("/tmp/uncaged-serve-test-nonexistent");
    const res = await fetch("/api/threads/running");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { threads: unknown[] };
    expect(body.threads).toEqual([]);
  });
});

describe("serve /api/cas", () => {
  test("returns empty list for missing storage", async () => {
    const { fetch } = buildApp("/tmp/uncaged-serve-test-nonexistent");
    const res = await fetch("/api/cas");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hashes: unknown[] };
    expect(body.hashes).toEqual([]);
  });

  test("returns 404 for missing hash", async () => {
    const { fetch } = buildApp("/tmp/uncaged-serve-test-nonexistent");
    const res = await fetch("/api/cas/nonexistent-hash");
    expect(res.status).toBe(404);
  });
});

describe("serve CAS round-trip", () => {
  const tmpDir = `/tmp/uncaged-serve-cas-test-${Date.now()}`;

  test("put then get", async () => {
    const { fetch } = buildApp(tmpDir);

    const putRes = await fetch("/api/cas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello world" }),
    });
    expect(putRes.status).toBe(201);
    const putBody = (await putRes.json()) as { hash: string };
    expect(typeof putBody.hash).toBe("string");

    const getRes = await fetch(`/api/cas/${putBody.hash}`);
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as { content: string };
    expect(getBody.content).toBe(casStoredForm("hello world"));

    // cleanup
    const delRes = await fetch(`/api/cas/${putBody.hash}`, { method: "DELETE" });
    expect(delRes.status).toBe(200);
  });
});
