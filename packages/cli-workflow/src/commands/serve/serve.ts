import { err, ok, type Result } from "@uncaged/workflow";
import { serve } from "bun";

import { printCliLine } from "../../cli-output.js";
import { createApp } from "./app.js";
import type { ServeOptions } from "./types.js";

export function startServer(storageRoot: string, options: ServeOptions): void {
  const app = createApp(storageRoot);

  const server = serve({
    fetch: app.fetch,
    port: options.port,
    hostname: options.hostname,
  });

  printCliLine(`uncaged-workflow API server listening on http://${server.hostname}:${server.port}`);
}

function parsePortValue(value: string | undefined): Result<number, string> {
  if (value === undefined) {
    return err("--port requires a value");
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 65535) {
    return err(`invalid port: ${value}`);
  }
  return ok(parsed);
}

function parseServeArgv(argv: string[]): Result<ServeOptions, string> {
  let port = 7860;
  let hostname = "127.0.0.1";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port" || arg === "-p") {
      const portResult = parsePortValue(argv[i + 1]);
      if (!portResult.ok) {
        return portResult;
      }
      port = portResult.value;
      i++;
    } else if (arg === "--host") {
      const next = argv[i + 1];
      if (next === undefined) {
        return err("--host requires a value");
      }
      hostname = next;
      i++;
    }
  }

  return ok({ port, hostname });
}

export async function dispatchServe(storageRoot: string, argv: string[]): Promise<number> {
  const parsed = parseServeArgv(argv);
  if (!parsed.ok) {
    printCliLine(`error: ${parsed.error}`);
    return 1;
  }

  startServer(storageRoot, parsed.value);

  // Keep process alive
  await new Promise(() => {});
  return 0;
}
