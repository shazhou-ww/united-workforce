import { describe, expect, test } from "bun:test";

import { createContentMerkleNode, serializeMerkleNode } from "@uncaged/workflow-cas";

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

describe("serve error handling", () => {
  test("POST /api/threads with invalid JSON body → 400", async () => {
    const { fetch } = buildApp("/tmp/uncaged-serve-test-nonexistent");
    const res = await fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid JSON body");
  });

  test("POST /api/cas with invalid JSON body → 400", async () => {
    const { fetch } = buildApp("/tmp/uncaged-serve-test-nonexistent");
    const res = await fetch("/api/cas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid JSON body");
  });

  test("POST /api/threads with missing required fields → 400", async () => {
    const { fetch } = buildApp("/tmp/uncaged-serve-test-nonexistent");
    const res = await fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ foo: "bar" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("required");
  });

  test("global error handler returns 500 with JSON", async () => {
    const app = createApp("/tmp/uncaged-serve-test-nonexistent");
    app.get("/test-error", () => {
      throw new Error("boom");
    });
    const res = await app.fetch(new Request("http://localhost/test-error"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Internal server error");
  });
});

describe("serve security", () => {
  test("CORS headers present on responses", async () => {
    const app = createApp("/tmp/uncaged-serve-test-nonexistent");
    const res2 = await app.fetch(
      new Request("http://localhost/healthz", {
        headers: { Origin: "http://localhost:5173" },
      }),
    );
    expect(res2.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
  });

  test("POST with body > 1MB → 413", async () => {
    const { fetch } = buildApp("/tmp/uncaged-serve-test-nonexistent");
    const largeBody = "x".repeat(1_048_577);
    const res = await fetch("/api/cas", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(largeBody.length),
      },
      body: largeBody,
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Payload too large");
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
