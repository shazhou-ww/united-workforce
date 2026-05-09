import { err, ok, type Result } from "@uncaged/workflow-util";

import type { ThreadPauseGate } from "./types.js";

/**
 * Pause/resume gate for workflow threads: after each generator yield the engine awaits
 * {@link ThreadPauseGate.awaitAfterYield}. Calling {@link ThreadPauseGate.pause} makes the next
 * await block until {@link ThreadPauseGate.resume}.
 */
export function createThreadPauseGate(): ThreadPauseGate {
  let resumeResolver: (() => void) | null = null;
  let chain: Promise<void> = Promise.resolve();
  let paused = false;

  function awaitAfterYield(): Promise<void> {
    return chain;
  }

  function pause(): Result<void, string> {
    if (paused) {
      return err("thread already paused");
    }
    paused = true;
    chain = new Promise<void>((resolve) => {
      resumeResolver = resolve;
    });
    return ok(undefined);
  }

  function resume(): Result<void, string> {
    if (!paused) {
      return err("thread not paused");
    }
    paused = false;
    const resolveFn = resumeResolver;
    resumeResolver = null;
    if (resolveFn !== null) {
      resolveFn();
    }
    chain = Promise.resolve();
    return ok(undefined);
  }

  function isPaused(): boolean {
    return paused;
  }

  return { awaitAfterYield, pause, resume, isPaused };
}
