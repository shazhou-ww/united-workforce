import { printCliLine } from "../../cli-output.js";

export async function registerWithGateway(
  gatewayUrl: string,
  name: string,
  localUrl: string,
  secret: string,
  clientToken: string,
): Promise<boolean> {
  try {
    const resp = await fetch(`${gatewayUrl}/api/gateway/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, url: localUrl, secret, clientToken }),
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
  localUrl: string,
  secret: string,
  clientToken: string,
  intervalMs: number,
): ReturnType<typeof setInterval> {
  return setInterval(() => {
    registerWithGateway(gatewayUrl, name, localUrl, secret, clientToken).catch(() => {});
  }, intervalMs);
}
