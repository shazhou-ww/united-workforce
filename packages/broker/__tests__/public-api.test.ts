import { describe, expect, test } from "vitest";
import * as broker from "../src/index.js";

describe("@united-workforce/broker public API surface", () => {
  test("exports the Phase 1 + Phase 2 names", () => {
    const names = Object.keys(broker).sort();
    expect(names).toEqual([
      "DEFAULT_SSE_HEARTBEAT_TIMEOUT_MS",
      "SUMERU_SESSION_NOT_FOUND",
      "SumeruSessionNotFoundError",
      "createBroker",
      "createSessionStore",
      "createSumeruClient",
    ]);
  });

  test("createSessionStore is a function", () => {
    expect(typeof broker.createSessionStore).toBe("function");
  });

  test("createSumeruClient is a function", () => {
    expect(typeof broker.createSumeruClient).toBe("function");
  });

  test("createBroker is a function", () => {
    expect(typeof broker.createBroker).toBe("function");
  });

  test("SumeruSessionNotFoundError is a class extending Error", () => {
    expect(typeof broker.SumeruSessionNotFoundError).toBe("function");
    const err = new broker.SumeruSessionNotFoundError("g", "s");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("sumeru_session_not_found");
  });

  test("SUMERU_SESSION_NOT_FOUND is the canonical code constant", () => {
    expect(broker.SUMERU_SESSION_NOT_FOUND).toBe("sumeru_session_not_found");
  });

  test("does not export reserved Phase 3+ names", () => {
    const reserved = ["Broker", "BrokerOptions", "runStep", "runTurn"];
    for (const name of reserved) {
      expect(broker).not.toHaveProperty(name);
    }
  });
});
