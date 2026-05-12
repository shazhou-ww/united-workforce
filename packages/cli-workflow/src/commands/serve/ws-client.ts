import type { LogFn } from "@uncaged/workflow-util";

export type GatewayWsClientParams = {
  gatewayUrl: string;
  name: string;
  secret: string;
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
    params.log("6CJX2RLP", `gateway WebSocket reconnect in ${delayMs}ms (attempt ${attempt})`);
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
      let preview: string;
      if (typeof ev.data === "string") {
        preview = ev.data;
      } else if (ev.data instanceof ArrayBuffer) {
        preview = `[binary ${String(ev.data.byteLength)} bytes]`;
      } else {
        preview = "[non-text message]";
      }
      params.log("3FHK5NDJ", `gateway → agent (phase 2 stub): ${preview.slice(0, 500)}`);
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
