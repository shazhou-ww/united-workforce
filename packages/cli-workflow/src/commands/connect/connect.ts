import { randomUUID } from "node:crypto";
import { hostname as osHostname } from "node:os";
import { ok, type Result } from "@uncaged/workflow-protocol";
import { createLogger } from "@uncaged/workflow-util";

import { printCliLine } from "../../cli-output.js";
import { createApp } from "./app.js";
import { registerWithGateway, startHeartbeat, unregisterFromGateway } from "./gateway.js";
import type { ConnectOptions } from "./types.js";
import { startGatewayWsClient } from "./ws-client.js";

const DEFAULT_GATEWAY_URL = "https://workflow-gateway.shazhou.workers.dev";
const HEARTBEAT_INTERVAL_MS = 60_000;

function requireNextArg(argv: string[], i: number, flag: string): Result<string, string> {
  const next = argv[i + 1];
  if (next === undefined) {
    return { ok: false, error: `${flag} requires a value` };
  }
  return ok(next);
}

function parseConnectArgv(argv: string[]): Result<ConnectOptions, string> {
  let name = osHostname().split(".")[0].toLowerCase();
  let gatewayUrl = DEFAULT_GATEWAY_URL;
  const gatewaySecret = process.env.WORKFLOW_DASHBOARD_SECRET ?? "";
  const stringFlags: Record<string, (v: string) => void> = {
    "--name": (v) => {
      name = v;
    },
    "--gateway": (v) => {
      gatewayUrl = v;
    },
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg in stringFlags) {
      const r = requireNextArg(argv, i, arg);
      if (!r.ok) return r;
      stringFlags[arg](r.value);
      i++;
    }
  }

  return ok({ name, gatewayUrl, gatewaySecret });
}

export async function dispatchConnect(storageRoot: string, argv: string[]): Promise<number> {
  const parsed = parseConnectArgv(argv);
  if (!parsed.ok) {
    printCliLine(`error: ${parsed.error}`);
    return 1;
  }

  const options = parsed.value;

  if (options.gatewaySecret === "") {
    printCliLine("error: WORKFLOW_DASHBOARD_SECRET is required");
    return 1;
  }

  const clientToken = randomUUID();
  const app = createApp(storageRoot, clientToken);

  const log = createLogger({ sink: { kind: "stderr" } });
  const stopWsClient = startGatewayWsClient({
    gatewayUrl: options.gatewayUrl,
    name: options.name,
    secret: options.gatewaySecret,
    appFetch: app.fetch,
    log,
  });

  printCliLine("connected to gateway via WebSocket");

  // Register with gateway for discovery
  const registered = await registerWithGateway(
    options.gatewayUrl,
    options.name,
    `ws://${options.name}`,
    options.gatewaySecret,
    clientToken,
  );
  if (registered) {
    printCliLine(`registered with gateway as "${options.name}"`);
  }

  const heartbeatTimer = startHeartbeat(
    options.gatewayUrl,
    options.name,
    `ws://${options.name}`,
    options.gatewaySecret,
    clientToken,
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
