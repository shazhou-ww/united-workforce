import * as broker from "../src/index.js";
import { describe, expect, test } from "vitest";

describe("@united-workforce/broker public API surface", () => {
  test("exports exactly the Phase 1 names", () => {
    const names = Object.keys(broker).sort();
    expect(names).toEqual(["createSessionStore"]);
  });

  test("createSessionStore is a function", () => {
    expect(typeof broker.createSessionStore).toBe("function");
  });

  test("does not export Phase 2/3 names", () => {
    const reserved = [
      "createBroker",
      "Broker",
      "BrokerOptions",
      "SumeruClient",
      "createSumeruClient",
      "runStep",
      "runTurn",
    ];
    for (const name of reserved) {
      expect(broker).not.toHaveProperty(name);
    }
  });
});
