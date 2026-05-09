import { useCallback, useEffect, useRef, useState } from "react";
import { getAgentHealth } from "../api.ts";

type HealthStatus = "connected" | "disconnected" | "reconnecting";

type Props = {
  agent: string | null;
  onRun: () => void;
};

function statusLabel(status: HealthStatus): { text: string; color: string } {
  if (status === "connected") {
    return { text: "● Connected", color: "var(--color-success)" };
  }
  if (status === "reconnecting") {
    return { text: "● Reconnecting...", color: "var(--color-warning, #f59e0b)" };
  }
  return { text: "● Offline", color: "var(--color-error)" };
}

export function StatusBar({ agent, onRun }: Props) {
  const [status, setStatus] = useState<HealthStatus>("disconnected");
  const wasConnectedRef = useRef(false);

  const checkHealth = useCallback(async () => {
    if (!agent) {
      setStatus("disconnected");
      return;
    }
    try {
      await getAgentHealth(agent);
      wasConnectedRef.current = true;
      setStatus("connected");
    } catch {
      if (wasConnectedRef.current) {
        setStatus("reconnecting");
      } else {
        setStatus("disconnected");
      }
    }
  }, [agent]);

  useEffect(() => {
    wasConnectedRef.current = false;
    setStatus("disconnected");
    checkHealth();
    const interval = setInterval(checkHealth, 10_000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  const label = statusLabel(status);

  return (
    <div
      className="flex items-center justify-between px-6 py-2 text-xs border-b"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <div className="flex items-center gap-4">
        <span style={{ color: "var(--color-text-muted)" }}>
          {agent ? `Agent: ${agent}` : "No agent selected"}
        </span>
        <button
          type="button"
          onClick={onRun}
          disabled={!agent}
          className="px-3 py-1 rounded text-xs font-medium"
          style={{
            background: agent ? "var(--color-accent)" : "var(--color-border)",
            color: "#fff",
            opacity: agent ? 1 : 0.5,
          }}
        >
          ▶ Run Thread
        </button>
      </div>
      <span style={{ color: label.color }}>{label.text}</span>
    </div>
  );
}
