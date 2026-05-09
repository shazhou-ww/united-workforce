import { randomUUID } from "node:crypto";
import { hostname as osHostname } from "node:os";
import { err, ok, type Result } from "@uncaged/workflow-protocol";
import { serve } from "bun";

import { printCliLine } from "../../cli-output.js";
import { createApp } from "./app.js";
import {
  registerWithGateway,
  startHeartbeat,
  startTunnel,
  unregisterFromGateway,
} from "./tunnel.js";
import type { ServeOptions } from "./types.js";

const DEFAULT_GATEWAY_URL = "https://workflow-gateway.shazhou.workers.dev";
const HEARTBEAT_INTERVAL_MS = 60_000;

export function startServer(storageRoot: string, options: ServeOptions, agentToken: string | null): void {
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
  let noTunnel = false;
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
    } else if (arg === "--no-tunnel") {
      noTunnel = true;
    } else if (arg in stringFlags) {
      const r = requireNextArg(argv, i, arg);
      if (!r.ok) return r;
      stringFlags[arg](r.value);
      i++;
    }
  }

  return ok({ port, hostname, name, noTunnel, gatewayUrl, gatewaySecret });
}

export async function dispatchServe(storageRoot: string, argv: string[]): Promise<number> {
  const parsed = parseServeArgv(argv);
  if (!parsed.ok) {
    printCliLine(`error: ${parsed.error}`);
    return 1;
  }

  const options = parsed.value;
  const agentToken = options.noTunnel ? null : randomUUID();
  startServer(storageRoot, options, agentToken);

  if (options.noTunnel) {
    printCliLine("tunnel disabled (--no-tunnel)");
    await new Promise(() => {});
    return 0;
  }

  // Start cloudflared quick tunnel
  printCliLine("starting cloudflared quick tunnel...");
  const tunnel = await startTunnel(options.port);

  if (!tunnel) {
    printCliLine("failed to create tunnel — continuing without gateway registration");
    await new Promise(() => {});
    return 0;
  }

  printCliLine(`tunnel: ${tunnel.url}`);

  // Register with gateway
  if (options.gatewaySecret) {
    const registered = await registerWithGateway(
      options.gatewayUrl,
      options.name,
      tunnel.url,
      options.gatewaySecret,
      agentToken!,
    );
    if (registered) {
      printCliLine(`registered with gateway as "${options.name}"`);
    }

    // Start heartbeat
    const heartbeatTimer = startHeartbeat(
      options.gatewayUrl,
      options.name,
      tunnel.url,
      options.gatewaySecret,
      agentToken!,
      HEARTBEAT_INTERVAL_MS,
    );

    // Cleanup on exit
    const cleanup = async () => {
      clearInterval(heartbeatTimer);
      printCliLine("unregistering from gateway...");
      await unregisterFromGateway(options.gatewayUrl, options.name, options.gatewaySecret);
      tunnel.process.kill();
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  } else {
    printCliLine("WORKFLOW_GATEWAY_SECRET not set — skipping gateway registration");
  }

  // Keep process alive
  await new Promise(() => {});
  return 0;
}
