import { Loader2, Play, Wifi, WifiOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getClientHealth } from "../api.ts";
import { Button } from "./ui/button.tsx";

type HealthStatus = "connected" | "disconnected" | "reconnecting";

type Props = {
  client: string | null;
  onRun: () => void;
};

function StatusIndicator({ status }: { status: HealthStatus }) {
  if (status === "connected") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-success transition-colors duration-200">
        <Wifi className="h-3.5 w-3.5" />
        Connected
      </span>
    );
  }
  if (status === "reconnecting") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-warning transition-colors duration-200">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Reconnecting…
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-destructive transition-colors duration-200">
      <WifiOff className="h-3.5 w-3.5" />
      Offline
    </span>
  );
}

export function StatusBar({ client, onRun }: Props) {
  const [status, setStatus] = useState<HealthStatus>("disconnected");
  const wasConnectedRef = useRef(false);

  const checkHealth = useCallback(async () => {
    if (!client) {
      setStatus("disconnected");
      return;
    }
    try {
      await getClientHealth(client);
      wasConnectedRef.current = true;
      setStatus("connected");
    } catch {
      if (wasConnectedRef.current) {
        setStatus("reconnecting");
      } else {
        setStatus("disconnected");
      }
    }
  }, [client]);

  useEffect(() => {
    wasConnectedRef.current = false;
    setStatus("disconnected");
    checkHealth();
    const interval = setInterval(checkHealth, 10_000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  return (
    <div className="flex items-center justify-between px-6 py-2 text-xs border-b border-border bg-card/80 backdrop-blur-sm">
      <div className="flex items-center gap-4">
        <span className="text-muted-foreground">
          {client ? `Client: ${client}` : "No client selected"}
        </span>
        <Button
          variant="default"
          size="sm"
          disabled={!client}
          onClick={onRun}
          className="h-7 gap-1.5 transition-all duration-200"
        >
          <Play className="h-3.5 w-3.5" />
          Run Thread
        </Button>
      </div>
      <StatusIndicator status={status} />
    </div>
  );
}
