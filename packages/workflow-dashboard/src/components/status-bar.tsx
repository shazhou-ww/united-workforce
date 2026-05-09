import { useCallback, useEffect, useRef, useState } from "react";
import { getHealth } from "../api.ts";

type HealthStatus = "connected" | "disconnected" | "reconnecting";

type Props = {
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

export function StatusBar({ onRun }: Props) {
  const [status, setStatus] = useState<HealthStatus>("disconnected");
  const wasConnectedRef = useRef(false);

  const checkHealth = useCallback(async () => {
    try {
      await getHealth();
      wasConnectedRef.current = true;
      setStatus("connected");
    } catch {
      if (wasConnectedRef.current) {
        setStatus("reconnecting");
      } else {
        setStatus("disconnected");
      }
    }
  }, []);

  useEffect(() => {
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
        <span style={{ color: "var(--color-text-muted)" }}>Local API: 127.0.0.1:7860</span>
        <button
          type="button"
          onClick={onRun}
          className="px-3 py-1 rounded text-xs font-medium"
          style={{ background: "var(--color-accent)", color: "#fff" }}
        >
          ▶ Run Thread
        </button>
      </div>
      <span style={{ color: label.color }}>{label.text}</span>
    </div>
  );
}
