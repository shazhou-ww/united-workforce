import { randomUUID } from "node:crypto";
import { hostname as osHostname } from "node:os";
import { err, ok, type Result } from "@uncaged/workflow-protocol";
import { createLogger } from "@uncaged/workflow-util";
import { serve } from "bun";

import { printCliLine } from "../../cli-output.js";
import { createApp } from "./app.js";
import { registerWithGateway, startHeartbeat, unregisterFromGateway } from "./gateway.js";
import type { ServeOptions } from "./types.js";
import { startGatewayWsClient } from "./ws-client.js";

const DEFAULT_GATEWAY_URL = "https://workflow-gateway.shazhou.workers.dev";
const HEARTBEAT_INTERVAL_MS = 60_000;

export function startServer(
  storageRoot: string,
  options: ServeOptions,
  agentToken: string | null,
): void {
  const app = createApp(storageRoot, agentToken);

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

function requireNextArg(argv: string[], i: number, flag: string): Result<string, string> {
  const next = argv[i + 1];
  if (next === undefined) {
    return err(`${flag} requires a value`);
  }
  return ok(next);
}

function parseServeArgv(argv: string[]): Result<ServeOptions, string> {
  let port = 7860;
  let hostname = "127.0.0.1";
  let name = osHostname().split(".")[0].toLowerCase();
  let gatewayUrl = DEFAULT_GATEWAY_URL;
  const gatewaySecret = process.env.WORKFLOW_GATEWAY_SECRET ?? "";
  const stringFlags: Record<string, (v: string) => void> = {
    "--host": (v) => {
      hostname = v;
    },
    "--name": (v) => {
      name = v;
    },
    "--gateway": (v) => {
      gatewayUrl = v;
    },
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port" || arg === "-p") {
      const portResult = parsePortValue(argv[i + 1]);
      if (!portResult.ok) return portResult;
      port = portResult.value;
      i++;
    } else if (arg in stringFlags) {
      const r = requireNextArg(argv, i, arg);
      if (!r.ok) return r;
      stringFlags[arg](r.value);
      i++;
    }
  }

  return ok({ port, hostname, name, gatewayUrl, gatewaySecret });
}

export async function dispatchServe(storageRoot: string, argv: string[]): Promise<number> {
  const parsed = parseServeArgv(argv);
  if (!parsed.ok) {
    printCliLine(`error: ${parsed.error}`);
    return 1;
  }

  const options = parsed.value;

  if (options.gatewaySecret === "") {
    // No gateway — local-only mode
    startServer(storageRoot, options, null);
    printCliLine("no WORKFLOW_GATEWAY_SECRET — running in local-only mode");
    await new Promise(() => {});
    return 0;
  }

  const agentToken = randomUUID();
  startServer(storageRoot, options, agentToken);

  // Start WebSocket reverse connection to gateway
  const log = createLogger({ sink: { kind: "stderr" } });
  const stopWsClient = startGatewayWsClient({
    gatewayUrl: options.gatewayUrl,
    name: options.name,
    secret: options.gatewaySecret,
    localPort: options.port,
    log,
  });

  printCliLine("connected to gateway via WebSocket");

  // Register with gateway for discovery
  const localUrl = `http://127.0.0.1:${options.port}`;
  const registered = await registerWithGateway(
    options.gatewayUrl,
    options.name,
    localUrl,
    options.gatewaySecret,
    agentToken,
  );
  if (registered) {
    printCliLine(`registered with gateway as "${options.name}"`);
  }

  const heartbeatTimer = startHeartbeat(
    options.gatewayUrl,
    options.name,
    localUrl,
    options.gatewaySecret,
    agentToken,
    HEARTBEAT_INTERVAL_MS,
  );

  const cleanup = async () => {
    clearInterval(heartbeatTimer);
    stopWsClient();
    printCliLine("unregistering from gateway...");
    await unregisterFromGateway(options.gatewayUrl, options.name, options.gatewaySecret);
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  await new Promise(() => {});
  return 0;
}
