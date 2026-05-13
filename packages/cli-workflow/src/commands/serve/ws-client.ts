import { parseWsRequestJson, type WsResponse } from "@uncaged/workflow-gateway/ws-protocol";
import type { LogFn } from "@uncaged/workflow-util";

export type GatewayWsClientParams = {
  gatewayUrl: string;
  name: string;
  secret: string;
  localPort: number;
  log: LogFn;
};

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export function buildGatewayWsConnectUrl(gatewayUrl: string, name: string, secret: string): string {
  const u = new URL(gatewayUrl);
  if (u.protocol === "https:") {
    u.protocol = "wss:";
  } else if (u.protocol === "http:") {
    u.protocol = "ws:";
  }
  u.pathname = "/ws/connect";
  u.search = "";
  u.searchParams.set("name", name);
  u.searchParams.set("secret", secret);
  return u.href;
}

function headersToRecord(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of h) {
    out[k] = v;
  }
  return out;
}

async function handleGatewayMessage(
  ws: WebSocket,
  raw: string,
  params: GatewayWsClientParams,
): Promise<void> {
  const req = parseWsRequestJson(raw);
  if (req === null) {
    params.log("ZM8K2PQ1", "gateway WebSocket dropped non-request message");
    return;
  }
  const localUrl = `http://127.0.0.1:${String(params.localPort)}${req.path}`;
  const initHeaders = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    initHeaders.set(k, v);
  }
  let resp: Response;
  try {
    resp = await fetch(localUrl, {
      method: req.method,
      headers: initHeaders,
      body: req.body === null ? undefined : req.body,
    });
  } catch (e) {
    params.log("R4N7BQ3C", `local proxy fetch failed: ${String(e)}`);
    const errBody: WsResponse = {
      id: req.id,
      status: 502,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "local fetch failed", detail: String(e) }),
    };
    ws.send(JSON.stringify(errBody));
    return;
  }
  const bodyText = await resp.text();
  const headerRecord = headersToRecord(resp.headers);
  const out: WsResponse = {
    id: req.id,
    status: resp.status,
    headers: headerRecord,
    body: bodyText,
  };
  ws.send(JSON.stringify(out));
}

/** Maintains a reverse WebSocket to the workflow gateway; reconnects with exponential backoff. */
export function startGatewayWsClient(params: GatewayWsClientParams): () => void {
  const wsUrl = buildGatewayWsConnectUrl(params.gatewayUrl, params.name, params.secret);
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let attempt = 0;

  const clearReconnectTimer = (): void => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = (): void => {
    if (stopped) {
      return;
    }
    clearReconnectTimer();
    const delayMs = Math.min(INITIAL_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
    attempt++;
    params.log("6CJX2R8P", `gateway WebSocket reconnect in ${delayMs}ms (attempt ${attempt})`);
    reconnectTimer = setTimeout(connect, delayMs);
  };

  const connect = (): void => {
    if (stopped) {
      return;
    }
    clearReconnectTimer();
    params.log("2XK7HM9Q", "gateway WebSocket connecting...");
    try {
      socket = new WebSocket(wsUrl);
    } catch (e) {
      params.log("7NQW4HBT", `gateway WebSocket create failed: ${String(e)}`);
      scheduleReconnect();
      return;
    }

    const ws = socket;

    ws.addEventListener("open", () => {
      attempt = 0;
      params.log("4PWN3V82", "gateway WebSocket connected");
    });

    ws.addEventListener("close", (ev) => {
      socket = null;
      params.log(
        "8QTR6ZKC",
        `gateway WebSocket closed code=${String(ev.code)} reason=${ev.reason} wasClean=${String(ev.wasClean)}`,
      );
      if (!stopped) {
        scheduleReconnect();
      }
    });

    ws.addEventListener("error", () => {
      params.log("9BWS1M7F", "gateway WebSocket error");
    });

    ws.addEventListener("message", (ev) => {
      const data = ev.data;
      if (typeof data !== "string") {
        params.log("T9W2K35H", "gateway WebSocket non-text frame ignored");
        return;
      }
      void handleGatewayMessage(ws, data, params).catch((e: unknown) => {
        params.log("V7KX2M9P", `gateway WebSocket handler error: ${String(e)}`);
      });
    });
  };

  connect();

  return (): void => {
    stopped = true;
    clearReconnectTimer();
    if (socket !== null && socket.readyState === WebSocket.OPEN) {
      socket.close(1000, "shutdown");
    }
    socket = null;
  };
}
