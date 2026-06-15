/**
 * Tests for `client.createSession` — POST URL, headers, body shape, and
 * envelope/error parsing.
 */

import { describe, expect, test } from "vitest";

import { createSumeruClient } from "../src/sumeru-client/index.js";
import { installFetchStub } from "./fetch-stub.js";

describe("client.createSession", () => {
  const fetchStub = installFetchStub();

  test("POSTs to /gateways/<gw>/sessions with body {} when cwd is null", async () => {
    fetchStub.setHandler(() => ({
      kind: "json",
      status: 201,
      body: {
        type: "@sumeru/session",
        value: { id: "ses_abc", gateway: "claude-code" },
      },
    }));

    const client = createSumeruClient("http://127.0.0.1:7900");
    const sessionId = await client.createSession({ gateway: "claude-code", cwd: null });

    expect(sessionId).toBe("ses_abc");
    expect(fetchStub.calls).toHaveLength(1);
    expect(fetchStub.calls[0].method).toBe("POST");
    expect(fetchStub.calls[0].url).toBe("http://127.0.0.1:7900/gateways/claude-code/sessions");
    expect(fetchStub.calls[0].body).toBe("{}");
    expect(fetchStub.calls[0].headers["content-type"]).toBe("application/json");
    expect(fetchStub.calls[0].headers.accept).toBe("application/json");
  });

  test("sends {workspaceRoot} body when cwd is provided", async () => {
    fetchStub.setHandler(() => ({
      kind: "json",
      status: 201,
      body: {
        type: "@sumeru/session",
        value: { id: "ses_with_cwd" },
      },
    }));

    const client = createSumeruClient("http://127.0.0.1:7900");
    const sessionId = await client.createSession({
      gateway: "hermes",
      cwd: "/tmp/work-xyz",
    });

    expect(sessionId).toBe("ses_with_cwd");
    expect(fetchStub.calls[0].url).toBe("http://127.0.0.1:7900/gateways/hermes/sessions");
    expect(JSON.parse(fetchStub.calls[0].body)).toEqual({ workspaceRoot: "/tmp/work-xyz" });
  });

  test("normalises trailing slash on host", async () => {
    fetchStub.setHandler(() => ({
      kind: "json",
      status: 201,
      body: { type: "@sumeru/session", value: { id: "ses_n" } },
    }));

    const client = createSumeruClient("http://127.0.0.1:7900/");
    await client.createSession({ gateway: "g", cwd: null });
    expect(fetchStub.calls[0].url).toBe("http://127.0.0.1:7900/gateways/g/sessions");
  });

  test("normalises multiple trailing slashes", async () => {
    fetchStub.setHandler(() => ({
      kind: "json",
      status: 201,
      body: { type: "@sumeru/session", value: { id: "ses_n" } },
    }));

    const client = createSumeruClient("http://127.0.0.1:7900///");
    await client.createSession({ gateway: "g", cwd: null });
    expect(fetchStub.calls[0].url).toBe("http://127.0.0.1:7900/gateways/g/sessions");
  });

  test("rejects with status + gateway + instance + code on non-2xx", async () => {
    fetchStub.setHandler(() => ({
      kind: "json",
      status: 404,
      body: {
        type: "@sumeru/error",
        value: { error: "gateway_not_found", message: "no such gateway" },
      },
    }));

    const client = createSumeruClient("http://127.0.0.1:7900");
    await expect(client.createSession({ gateway: "nope", cwd: null })).rejects.toThrow(
      /HTTP 404 gateway_not_found.*gateway=nope.*instance=http:\/\/127.0.0.1:7900/,
    );
  });

  test("rejects on 2xx with malformed body (no @sumeru/session envelope)", async () => {
    fetchStub.setHandler(() => ({
      kind: "json",
      status: 200,
      body: { id: "ses_no_envelope" },
    }));

    const client = createSumeruClient("http://127.0.0.1:7900");
    await expect(client.createSession({ gateway: "g", cwd: null })).rejects.toThrow(
      /unexpected body/,
    );
  });

  test("rejects on 2xx with empty value.id", async () => {
    fetchStub.setHandler(() => ({
      kind: "json",
      status: 200,
      body: { type: "@sumeru/session", value: { id: "" } },
    }));

    const client = createSumeruClient("http://127.0.0.1:7900");
    await expect(client.createSession({ gateway: "g", cwd: null })).rejects.toThrow(
      /unexpected body/,
    );
  });

  test("does not retry on its own", async () => {
    let count = 0;
    fetchStub.setHandler(() => {
      count += 1;
      return {
        kind: "json",
        status: 500,
        body: { type: "@sumeru/error", value: { error: "internal", message: "oops" } },
      };
    });
    const client = createSumeruClient("http://127.0.0.1:7900");
    await expect(client.createSession({ gateway: "g", cwd: null })).rejects.toThrow(/HTTP 500/);
    expect(count).toBe(1);
  });
});
