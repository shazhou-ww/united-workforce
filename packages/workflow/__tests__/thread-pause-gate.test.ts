import { describe, expect, test } from "bun:test";

import { createThreadPauseGate } from "../src/engine/thread-pause-gate.js";

describe("createThreadPauseGate", () => {
  test("pause blocks awaitAfterYield until resume", async () => {
    const gate = createThreadPauseGate();
    gate.pause();

    let progressed = false;
    const wait = (async () => {
      await gate.awaitAfterYield();
      progressed = true;
    })();

    await new Promise((r) => setTimeout(r, 30));
    expect(progressed).toBe(false);

    gate.resume();
    await wait;
    expect(progressed).toBe(true);
  });

  test("duplicate pause and resume are rejected", () => {
    const gate = createThreadPauseGate();
    expect(gate.pause().ok).toBe(true);
    expect(gate.pause().ok).toBe(false);
    expect(gate.resume().ok).toBe(true);
    expect(gate.resume().ok).toBe(false);
  });
});
