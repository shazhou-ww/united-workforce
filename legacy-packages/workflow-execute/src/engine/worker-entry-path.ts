import { fileURLToPath } from "node:url";

/** Absolute path to `worker-host.ts` for spawning bundle worker processes. */
export function getWorkerHostScriptPath(): string {
  return fileURLToPath(new URL("./worker.ts", import.meta.url));
}
