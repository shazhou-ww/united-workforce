import { printCliLine } from "../../cli-output.js";

type TunnelHandle = {
  process: ReturnType<typeof Bun.spawn>;
  url: string;
};

export async function startTunnel(port: number): Promise<TunnelHandle | null> {
  const proc = Bun.spawn(["cloudflared", "tunnel", "--url", `http://localhost:${port}`], {
    stdout: "pipe",
    stderr: "pipe",
  });

  // cloudflared prints the URL to stderr
  const reader = proc.stderr.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const match = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) {
      // Release the reader so stderr keeps flowing without backpressure
      reader.releaseLock();
      return { process: proc, url: match[0] };
    }
  }

  reader.releaseLock();
  proc.kill();
  return null;
}

export async function registerWithGateway(
  gatewayUrl: string,
  name: string,
  tunnelUrl: string,
  secret: string,
  agentToken: string,
): Promise<boolean> {
  try {
    const resp = await fetch(`${gatewayUrl}/api/gateway/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, url: tunnelUrl, secret, agentToken }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      printCliLine(`gateway registration failed: ${resp.status} ${body}`);
      return false;
    }
    return true;
  } catch (e) {
    printCliLine(`gateway registration error: ${e}`);
    return false;
  }
}

export async function unregisterFromGateway(
  gatewayUrl: string,
  name: string,
  secret: string,
): Promise<void> {
  try {
    await fetch(`${gatewayUrl}/api/gateway/register/${name}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${secret}` },
    });
  } catch {
    // Best effort — process is exiting
  }
}

export function startHeartbeat(
  gatewayUrl: string,
  name: string,
  tunnelUrl: string,
  secret: string,
  agentToken: string,
  intervalMs: number,
): ReturnType<typeof setInterval> {
  return setInterval(() => {
    registerWithGateway(gatewayUrl, name, tunnelUrl, secret, agentToken).catch(() => {});
  }, intervalMs);
}
